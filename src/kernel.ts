import { randomUUID } from "node:crypto";
import type { ActionContext, ActionDefinition, DefinedAction } from "./action.js";
import { CacheManager } from "./cache.js";
import { randomToken, redactValue, sha256, stableStringify } from "./crypto.js";
import { asGuildGateError, errors, GuildGateError } from "./errors.js";
import { messageFor, resolveLocale } from "./i18n.js";
import { runWithDeadline } from "./resilience.js";
import {
  assertAllowedOrigin,
  createCsrfService,
  isUnsafeMethod,
  serializeClearedCookie,
  serializeSessionCookie,
  validateAllowedOrigins,
  validateCookieConfig,
  type CookieConfig,
} from "./security.js";
import { SessionManager } from "./session.js";
import type { GuildGateStores } from "./stores.js";
import type {
  ActionExecutionMeta,
  ActionExecutionResult,
  AuditEvent,
  Clock,
  EnvironmentName,
  RateLimitHitResult,
  RealtimeEvent,
  RequestEnvelope,
  ResourceRef,
  SessionRecord,
  SupportedLocale,
} from "./types.js";
import { systemClock } from "./types.js";

export interface RealtimePublisher {
  publish(event: RealtimeEvent): Promise<void>;
}

export interface GuildGateConfig {
  app: {
    name: string;
    environment: EnvironmentName;
    baseUrl: string;
  };
  owners?: string[];
  locale?: {
    default?: SupportedLocale;
    messages?: Partial<Record<SupportedLocale, Record<string, string>>>;
  };
  security: {
    allowedOrigins: string[];
    csrfSecret: string;
    auditIpSalt: string;
    session: {
      ttlMs: number;
      idleTimeoutMs: number;
      rotateAfterMs: number;
      maximumSessionsPerUser: number;
    };
    cookie?: Partial<CookieConfig>;
  };
  stores: GuildGateStores;
  realtime?: RealtimePublisher;
  audit?: {
    enabled?: boolean;
    redactKeys?: string[];
    failClosedActions?: string[];
  };
  clock?: Clock;
}

export interface GuildGateKernel {
  readonly config: GuildGateConfig;
  readonly sessions: SessionManager;
  readonly cache: CacheManager;
  readonly cookie: CookieConfig;
  readonly csrf: {
    issue(sessionIdHash: string): string;
    verify(sessionIdHash: string, token: string | undefined): boolean;
  };
  action<I, O>(definition: ActionDefinition<I, O>): DefinedAction<I, O>;
  execute<I, O>(action: DefinedAction<I, O>, request: RequestEnvelope): Promise<ActionExecutionResult<O>>;
  createSession(input: { userId: string; locale?: string; metadata?: Record<string, unknown> }): Promise<{
    session: SessionRecord;
    sessionToken: string;
    csrfToken: string;
    setCookie: string;
  }>;
  revokeSession(token: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<number>;
  sessionCookie(token: string): string;
  clearSessionCookie(): string;
  owner: {
    setMaintenance(input: { enabled: boolean; reason?: string; allowOwners?: boolean }): Promise<void>;
    block(input: { subjectType: "user" | "guild" | "ip"; subjectId: string; reason: string; expiresAt?: string }): Promise<void>;
    unblock(subjectType: "user" | "guild" | "ip", subjectId: string): Promise<void>;
  };
}

export function createGuildGate(config: GuildGateConfig): GuildGateKernel {
  validateConfig(config);

  const clock = config.clock ?? systemClock;
  const owners = new Set(config.owners ?? []);
  const defaultLocale = config.locale?.default ?? "en";
  const origins = validateAllowedOrigins(config.security.allowedOrigins, config.app.environment);
  const csrf = createCsrfService(config.security.csrfSecret);
  const cache = new CacheManager(config.stores.cache, config.stores.locks);
  const cookie: CookieConfig = {
    name: config.security.cookie?.name ?? (config.app.environment === "production" ? "__Host-guildgate.sid" : "guildgate.sid"),
    path: config.security.cookie?.path ?? "/",
    secure: config.security.cookie?.secure ?? config.app.environment === "production",
    sameSite: config.security.cookie?.sameSite ?? "Lax",
    maxAgeSeconds: config.security.cookie?.maxAgeSeconds ?? Math.floor(config.security.session.ttlMs / 1000),
  };
  validateCookieConfig(cookie);
  const sessions = new SessionManager({ store: config.stores.sessions, clock, ...config.security.session });
  const sensitiveKeys = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "token",
    "accesstoken",
    "refreshtoken",
    "bottoken",
    "clientsecret",
    "csrftoken",
    ...(config.audit?.redactKeys ?? []).map((key) => key.toLowerCase()),
  ]);
  const auditFailClosed = new Set(config.audit?.failClosedActions ?? []);

  async function executeAction<I, O>(
    action: DefinedAction<I, O>,
    request: RequestEnvelope,
  ): Promise<ActionExecutionResult<O>> {
    const definition = action.definition;
    const requestId = request.requestId ?? randomUUID();
    const locale = resolveLocale(request.locale, defaultLocale);
    const startedAt = Date.now();
    let session: SessionRecord | null = null;
    let replacementSessionToken: string | undefined;
    let replacementCsrfToken: string | undefined;
    let clearSessionCookie = false;
    let resource: ResourceRef | undefined;
    let parsedInput!: I;
    let rateLimitMeta: RateLimitHitResult | undefined;
    let lockKey: string | undefined;
    let lockToken: string | undefined;
    let idempotencyStoreKey: string | undefined;
    let idempotencyCompleted = false;
    const postCommitIssues: ActionExecutionMeta["postCommitIssues"] = [];
    let contextBase: Omit<ActionContext, "signal"> | undefined;

    const meta = (): ActionExecutionMeta => ({
      requestId,
      locale,
      rateLimit: rateLimitMeta,
      replacementSessionToken,
      replacementCsrfToken,
      clearSessionCookie,
      postCommitIssues: postCommitIssues.length ? [...postCommitIssues] : undefined,
    });

    try {
      const authMode = definition.authentication ?? "required";
      if (authMode !== "none") {
        const resolution = await sessions.resolve(request.sessionToken ?? request.cookies?.[cookie.name]);
        session = resolution.session;
        replacementSessionToken = resolution.replacementToken;
        clearSessionCookie = resolution.clearCookie ?? false;
        if (replacementSessionToken && session) replacementCsrfToken = csrf.issue(session.idHash);
        if (authMode === "required" && !session) throw errors.authenticationRequired();
      }

      if (isUnsafeMethod(request.method)) {
        assertAllowedOrigin(request.origin ?? firstHeader(request.headers, "origin"), origins);
        const csrfMode = definition.csrf ?? (authMode === "none" ? "disabled" : "required");
        const csrfToken = request.csrfToken ?? firstHeader(request.headers, "x-csrf-token");
        if (csrfMode === "required" && (!session || !csrf.verify(session.idHash, csrfToken))) {
          throw errors.csrfInvalid();
        }
      }

      try {
        parsedInput = definition.parse ? definition.parse(request.input) : request.input as I;
      } catch (error) {
        throw errors.inputInvalid({ cause: error instanceof Error ? error.message : String(error) });
      }
      resource = definition.resource?.(parsedInput);

      contextBase = {
        requestId,
        request,
        locale,
        session,
        userId: session?.userId,
        isOwner: session ? owners.has(session.userId) : false,
        stores: config.stores,
        cache,
        now: clock.now(),
      };

      await enforcePolicies(contextBase, resource);

      if (definition.rateLimit) {
        const subject = definition.rateLimit.key?.(contextBase, parsedInput)
          ?? `${definition.name}:${session?.userId ?? request.ip ?? "anonymous"}`;
        rateLimitMeta = await config.stores.rateLimits.hit({
          key: `guildgate:rate:${subject}`,
          limit: definition.rateLimit.limit,
          windowMs: definition.rateLimit.windowMs,
          cost: definition.rateLimit.cost,
          nowMs: clock.now().getTime(),
        });
        if (!rateLimitMeta.allowed) throw errors.rateLimited(rateLimitMeta.retryAfterMs);
      }

      const decision = await definition.authorize?.(contextBase, parsedInput);
      if (decision && !decision.allowed) {
        throw new GuildGateError({
          code: decision.code ?? "GUILD_ACCESS_DENIED",
          status: 403,
          details: decision.details,
        });
      }

      if (definition.idempotency) {
        const key = request.idempotencyKey ?? firstHeader(request.headers, "idempotency-key");
        if (definition.idempotency.required !== false && !key) throw errors.idempotencyRequired();
        if (key) {
          const scope = definition.idempotency.scope?.(contextBase, parsedInput)
            ?? `${session?.userId ?? request.ip ?? "anonymous"}:${definition.name}`;
          idempotencyStoreKey = `guildgate:idempotency:${scope}:${key}`;
          const nowMs = clock.now().getTime();
          const begin = await config.stores.idempotency.begin({
            key: idempotencyStoreKey,
            requestHash: sha256(stableStringify(parsedInput)),
            state: "inflight",
            createdAtMs: nowMs,
            expiresAtMs: nowMs + definition.idempotency.ttlMs,
          });
          if (begin.status === "completed") {
            return { ok: true, data: begin.response as O, meta: meta() };
          }
          if (begin.status === "conflict") throw errors.idempotencyConflict();
          if (begin.status === "inflight") throw errors.idempotencyInflight();
        }
      }

      if (definition.concurrency) {
        lockKey = `guildgate:lock:${definition.concurrency.key(contextBase, parsedInput)}`;
        lockToken = randomToken(18);
        const acquired = await config.stores.locks.acquire(
          lockKey,
          lockToken,
          definition.concurrency.ttlMs ?? Math.max(5_000, definition.timeoutMs ?? 8_000),
          definition.concurrency.waitMs ?? 0,
        );
        if (!acquired) throw errors.lockUnavailable();
      }

      const deadlineInput: {
        timeoutMs: number;
        parentSignal?: AbortSignal;
        execute: (signal: AbortSignal) => Promise<O>;
      } = {
        timeoutMs: definition.timeoutMs ?? 8_000,
        execute: (signal) => definition.execute({ ...contextBase!, signal }, parsedInput),
      };
      if (request.signal) deadlineInput.parentSignal = request.signal;
      const result = await runWithDeadline(deadlineInput);

      // Once execute() returns, the application may already have committed its write.
      // Complete idempotency before non-transactional post-commit work so a retry cannot
      // repeat the domain operation after cache, realtime, or general audit failure.
      if (idempotencyStoreKey && definition.idempotency) {
        await config.stores.idempotency.complete(
          idempotencyStoreKey,
          result,
          clock.now().getTime() + definition.idempotency.ttlMs,
        );
        idempotencyCompleted = true;
      }

      try {
        const tags = definition.cache?.invalidateTags?.(result, parsedInput) ?? [];
        if (tags.length) await cache.invalidateTags(tags);
      } catch (cacheError) {
        postCommitIssues.push({ stage: "cache", code: asGuildGateError(cacheError).code });
      }

      try {
        if (definition.realtime) {
          const events: RealtimeEvent[] = definition.realtime.events(result, parsedInput).map((event) => ({
            ...event,
            version: 1,
            id: randomUUID(),
            timestamp: clock.now().toISOString(),
          }));
          for (const event of events) {
            if (definition.realtime.delivery === "outbox") {
              await config.stores.outbox.enqueue({ id: event.id, event, createdAt: event.timestamp, attempts: 0 });
            } else if (config.realtime) {
              await config.realtime.publish(event);
            }
          }
        }
      } catch (realtimeError) {
        postCommitIssues.push({ stage: "realtime", code: asGuildGateError(realtimeError).code });
      }

      try {
        await writeAudit({
          definition,
          context: contextBase,
          resource,
          result: "success",
          changes: definition.audit?.changes?.(result, parsedInput),
          durationMs: Date.now() - startedAt,
        });
      } catch (auditError) {
        postCommitIssues.push({ stage: "audit", code: asGuildGateError(auditError).code });
        if (auditFailClosed.has(definition.name)) throw auditError;
      }

      return { ok: true, data: result, meta: meta() };
    } catch (unknownError) {
      if (idempotencyStoreKey && !idempotencyCompleted) {
        await config.stores.idempotency.fail(idempotencyStoreKey).catch(() => undefined);
      }
      const error = asGuildGateError(unknownError);
      const fallbackContext: Omit<ActionContext, "signal"> = contextBase ?? {
        requestId,
        request,
        locale,
        session,
        userId: session?.userId,
        isOwner: session ? owners.has(session.userId) : false,
        stores: config.stores,
        cache,
        now: clock.now(),
      };
      await writeAudit({
        definition,
        context: fallbackContext,
        resource,
        result: error.status === 401 || error.status === 403 ? "denied" : "failed",
        reasonCode: error.code,
        durationMs: Date.now() - startedAt,
      }).catch(() => undefined);

      return {
        ok: false,
        error: {
          code: error.code,
          message: error.expose && error.message !== error.code
            ? error.message
            : config.locale?.messages?.[locale]?.[error.code] ?? messageFor(error.code, locale),
          status: error.status,
          retryable: error.retryable,
          details: error.details,
        },
        meta: meta(),
      };
    } finally {
      if (lockKey && lockToken) {
        await config.stores.locks.release(lockKey, lockToken).catch(() => undefined);
      }
    }
  }

  async function enforcePolicies(
    context: Omit<ActionContext, "signal">,
    resource: ResourceRef | undefined,
  ): Promise<void> {
    const maintenance = await config.stores.policies.getMaintenance();
    if (maintenance.enabled && !(maintenance.allowOwners && context.isOwner)) {
      throw errors.maintenance(maintenance.reason);
    }
    const nowIso = clock.now().toISOString();
    if (context.userId) {
      const block = await config.stores.policies.getBlock("user", context.userId, nowIso);
      if (block) throw errors.subjectBlocked(block.reason);
    }
    if (context.request.ip) {
      const block = await config.stores.policies.getBlock("ip", context.request.ip, nowIso);
      if (block) throw errors.subjectBlocked(block.reason);
    }
    if (resource?.type === "guild") {
      const block = await config.stores.policies.getBlock("guild", resource.id, nowIso);
      if (block) throw errors.subjectBlocked(block.reason);
    }
  }

  async function writeAudit<I, O>(input: {
    definition: ActionDefinition<I, O>;
    context: Omit<ActionContext, "signal">;
    resource?: ResourceRef;
    result: AuditEvent["result"];
    reasonCode?: string;
    changes?: unknown;
    durationMs: number;
  }): Promise<void> {
    if (config.audit?.enabled === false || input.definition.audit?.enabled === false) return;
    const policyVersion = await config.stores.policies.getPolicyVersion();
    const metadata: AuditEvent["metadata"] = { durationMs: input.durationMs };
    if (input.context.request.ip) {
      metadata.ipHash = sha256(`${config.security.auditIpSalt}:${input.context.request.ip}`);
    }
    if (input.context.request.userAgent) metadata.userAgent = input.context.request.userAgent;

    await config.stores.audit.write({
      id: randomUUID(),
      requestId: input.context.requestId,
      action: input.definition.name,
      actor: input.context.session
        ? {
            type: input.context.isOwner ? "owner" : "user",
            userId: input.context.session.userId,
            sessionIdHash: input.context.session.idHash,
          }
        : { type: "anonymous" },
      resource: input.resource,
      result: input.result,
      reasonCode: input.reasonCode,
      policyVersion,
      changes: redactValue(input.changes, sensitiveKeys),
      metadata,
      createdAt: clock.now().toISOString(),
    });
  }

  const kernel: GuildGateKernel = {
    config,
    sessions,
    cache,
    cookie,
    csrf,
    action<I, O>(definition: ActionDefinition<I, O>): DefinedAction<I, O> {
      if (!definition.name.trim()) throw errors.configuration("Action names cannot be empty");
      if (auditFailClosed.has(definition.name) && !definition.idempotency) {
        throw errors.configuration(`Audit fail-closed action ${definition.name} must use idempotency`);
      }
      return Object.freeze({ definition });
    },
    execute: executeAction,
    async createSession(input) {
      const locale = resolveLocale(input.locale, defaultLocale);
      const created = await sessions.create({
        userId: input.userId,
        locale,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
      return {
        session: created.session,
        sessionToken: created.token,
        csrfToken: csrf.issue(created.session.idHash),
        setCookie: serializeSessionCookie(created.token, cookie),
      };
    },
    revokeSession: (token) => sessions.revokeToken(token),
    revokeUserSessions: (userId) => sessions.revokeAll(userId),
    sessionCookie: (token) => serializeSessionCookie(token, cookie),
    clearSessionCookie: () => serializeClearedCookie(cookie),
    owner: {
      async setMaintenance(input) {
        await config.stores.policies.setMaintenance({
          enabled: input.enabled,
          allowOwners: input.allowOwners ?? true,
          updatedAt: clock.now().toISOString(),
          ...(input.reason ? { reason: input.reason } : {}),
        });
        await config.stores.policies.bumpPolicyVersion();
      },
      async block(input) {
        await config.stores.policies.putBlock({ ...input, createdAt: clock.now().toISOString() });
        await config.stores.policies.bumpPolicyVersion();
      },
      async unblock(subjectType, subjectId) {
        await config.stores.policies.removeBlock(subjectType, subjectId);
        await config.stores.policies.bumpPolicyVersion();
      },
    },
  };

  return kernel;
}

function validateConfig(config: GuildGateConfig): void {
  if (!config.app.name.trim()) throw errors.configuration("app.name is required");
  const baseUrl = new URL(config.app.baseUrl);
  if (config.app.environment === "production" && baseUrl.protocol !== "https:") {
    throw errors.configuration("app.baseUrl must use HTTPS in production");
  }
  if (Buffer.byteLength(config.security.auditIpSalt) < 16) {
    throw errors.configuration("auditIpSalt must contain at least 16 bytes");
  }
  const session = config.security.session;
  if (session.ttlMs <= 0 || session.idleTimeoutMs <= 0 || session.rotateAfterMs <= 0) {
    throw errors.configuration("Session timeouts must be positive");
  }
  if (session.maximumSessionsPerUser < 1) {
    throw errors.configuration("maximumSessionsPerUser must be at least 1");
  }
  if (config.app.environment === "production" && config.security.cookie?.secure === false) {
    throw errors.configuration("Secure session cookies cannot be disabled in production");
  }
}

function firstHeader(headers: RequestEnvelope["headers"], name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}
