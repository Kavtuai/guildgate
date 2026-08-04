import type { DefinedAction } from "./action.js";
import type { AnalyticsStore } from "./analytics/store.js";
import type { MetricQuery } from "./analytics/types.js";
import { errors } from "./errors.js";
import type { GuildGateKernel } from "./kernel.js";
import type { AuditEvent, BlockRecord, MaintenanceState, SessionRecord } from "./types.js";

export interface PageInput {
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface PublicSession {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  metadata?: Record<string, unknown>;
}

export interface RatePolicyDefinition {
  name: string;
  limit: number;
  windowMs: number;
  description?: string;
  ownerResettable?: boolean;
}

export class RatePolicyRegistry {
  private readonly policies = new Map<string, RatePolicyDefinition>();

  register(policy: RatePolicyDefinition): this {
    if (!policy.name.trim() || policy.limit < 1 || policy.windowMs < 1) throw new TypeError("Invalid rate policy");
    this.policies.set(policy.name, Object.freeze({ ...policy }));
    return this;
  }

  get(name: string): RatePolicyDefinition | undefined {
    const policy = this.policies.get(name);
    return policy ? { ...policy } : undefined;
  }

  list(): RatePolicyDefinition[] {
    return [...this.policies.values()].map((policy) => ({ ...policy })).sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function createOperatorService(input: {
  kernel: GuildGateKernel;
  analytics?: AnalyticsStore;
  ratePolicies?: RatePolicyRegistry;
  sessionMetadata?: (metadata: Record<string, unknown> | undefined) => Record<string, unknown> | undefined;
}) {
  return {
    async listSessions(userId: string, currentSessionIdHash: string | undefined, page?: PageInput): Promise<Page<PublicSession>> {
      const rows = await input.kernel.sessions.list(userId);
      const sorted = rows.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
      return paginate(sorted, page, (row) => row.idHash).map((row) => publicSession(row, currentSessionIdHash, input.sessionMetadata));
    },
    async revokeSession(userId: string, sessionIdHash: string): Promise<boolean> {
      const rows = await input.kernel.sessions.list(userId);
      if (!rows.some((row) => row.idHash === sessionIdHash)) return false;
      await input.kernel.sessions.revokeHash(sessionIdHash);
      return true;
    },
    async revokeOtherSessions(userId: string, currentSessionIdHash: string): Promise<number> {
      const rows = await input.kernel.sessions.list(userId);
      const targets = rows.filter((row) => row.idHash !== currentSessionIdHash);
      await Promise.all(targets.map((row) => input.kernel.sessions.revokeHash(row.idHash)));
      return targets.length;
    },
    async listAudit(filter?: { userId?: string; action?: string; cursor?: string; limit?: number }): Promise<Page<AuditEvent>> {
      const store = input.kernel.config.stores.audit;
      const limit = Math.min(200, Math.max(1, filter?.limit ?? 50));
      if (store.listPage) return store.listPage({ ...filter, limit });
      if (!store.list) return { items: [] };
      const rows = await store.list({ userId: filter?.userId, action: filter?.action, limit: 500 });
      return paginate(rows, filter, (row) => row.id);
    },
    async inspectPolicies(): Promise<{
      version: number;
      maintenance: Awaited<ReturnType<GuildGateKernel["config"]["stores"]["policies"]["getMaintenance"]>>;
      blocks: BlockRecord[];
      ratePolicies: RatePolicyDefinition[];
    }> {
      return {
        version: await input.kernel.config.stores.policies.getPolicyVersion(),
        maintenance: await input.kernel.config.stores.policies.getMaintenance(),
        blocks: await input.kernel.config.stores.policies.listBlocks?.({ limit: 500 }) ?? [],
        ratePolicies: input.ratePolicies?.list() ?? [],
      };
    },
    async resetRateLimit(key: string): Promise<void> {
      await input.kernel.config.stores.rateLimits.reset(key);
    },
    async queryMetrics(query: MetricQuery) {
      if (!input.analytics) throw errors.configuration("Analytics store is not configured");
      return input.analytics.query(query);
    },
  };
}

export function createOperatorActions(input: {
  kernel: GuildGateKernel;
  analytics?: AnalyticsStore;
  ratePolicies?: RatePolicyRegistry;
  sessionMetadata?: (metadata: Record<string, unknown> | undefined) => Record<string, unknown> | undefined;
}): {
  listSessions: DefinedAction<PageInput, Page<PublicSession>>;
  revokeSession: DefinedAction<{ sessionId: string }, { revoked: boolean }>;
  revokeOtherSessions: DefinedAction<void, { revoked: number }>;
  listAudit: DefinedAction<{ userId?: string; action?: string; cursor?: string; limit?: number }, Page<AuditEvent>>;
  inspectPolicies: DefinedAction<void, { version: number; maintenance: MaintenanceState; blocks: BlockRecord[]; ratePolicies: RatePolicyDefinition[] }>;
  queryMetrics: DefinedAction<MetricQuery, Awaited<ReturnType<AnalyticsStore["query"]>>>;
  resetRateLimit: DefinedAction<{ key: string; policyName?: string }, { reset: true }>;
  setMaintenance: DefinedAction<{ enabled: boolean; reason?: string; allowOwners?: boolean }, { updated: true }>;
  blockSubject: DefinedAction<Omit<BlockRecord, "createdAt">, { blocked: true }>;
  unblockSubject: DefinedAction<{ subjectType: BlockRecord["subjectType"]; subjectId: string }, { unblocked: true }>;
} {
  const service = createOperatorService(input);
  const ownerOnly = ({ isOwner }: { isOwner: boolean }) => isOwner ? { allowed: true } : { allowed: false, code: "OWNER_REQUIRED" };

  return {
    listSessions: input.kernel.action({
      name: "operator.sessions.list",
      authentication: "required",
      csrf: "disabled",
      parse: parsePageInput,
      async execute(context, page) {
        return service.listSessions(context.userId!, context.session?.idHash, page);
      },
    }),
    revokeSession: input.kernel.action({
      name: "operator.sessions.revoke",
      parse: (value) => requiredStringObject(value, "sessionId", ["sessionId"], 512) as { sessionId: string },
      idempotency: { required: false, ttlMs: 60_000 },
      async execute(context, value) {
        return { revoked: await service.revokeSession(context.userId!, value.sessionId) };
      },
    }),
    revokeOtherSessions: input.kernel.action({
      name: "operator.sessions.revoke-others",
      idempotency: { required: false, ttlMs: 60_000 },
      async execute(context) {
        return { revoked: await service.revokeOtherSessions(context.userId!, context.session!.idHash) };
      },
    }),
    listAudit: input.kernel.action({
      name: "operator.audit.list",
      authentication: "required",
      csrf: "disabled",
      authorize: ownerOnly,
      parse: parseAuditInput,
      execute: (_context, filter) => service.listAudit(filter),
    }),
    inspectPolicies: input.kernel.action({
      name: "operator.policies.inspect",
      authentication: "required",
      csrf: "disabled",
      authorize: ownerOnly,
      execute: () => service.inspectPolicies(),
    }),
    queryMetrics: input.kernel.action({
      name: "operator.analytics.query",
      authentication: "required",
      csrf: "disabled",
      authorize: ownerOnly,
      parse: parseMetricQuery,
      execute: (_context, query) => service.queryMetrics(query),
    }),
    resetRateLimit: input.kernel.action({
      name: "operator.rates.reset",
      authorize: ownerOnly,
      parse: parseRateResetInput,
      idempotency: { required: false, ttlMs: 60_000 },
      async execute(_context, value) {
        const policy = value.policyName ? input.ratePolicies?.get(value.policyName) : undefined;
        if (policy && policy.ownerResettable === false) throw errors.ratePolicyResetDenied(policy.name);
        await service.resetRateLimit(value.key);
        return { reset: true as const };
      },
    }),
    setMaintenance: input.kernel.action({
      name: "operator.maintenance.set",
      authorize: ownerOnly,
      parse: parseMaintenanceInput,
      idempotency: { required: false, ttlMs: 60_000 },
      async execute(_context, value) {
        await input.kernel.owner.setMaintenance(value);
        return { updated: true as const };
      },
    }),
    blockSubject: input.kernel.action({
      name: "operator.subject.block",
      authorize: ownerOnly,
      parse: parseBlockInput,
      idempotency: { required: false, ttlMs: 60_000 },
      async execute(_context, value) {
        await input.kernel.owner.block(value);
        return { blocked: true as const };
      },
    }),
    unblockSubject: input.kernel.action({
      name: "operator.subject.unblock",
      authorize: ownerOnly,
      parse: parseUnblockInput,
      idempotency: { required: false, ttlMs: 60_000 },
      async execute(_context, value) {
        await input.kernel.owner.unblock(value.subjectType, value.subjectId);
        return { unblocked: true as const };
      },
    }),
  };
}

function publicSession(row: SessionRecord, currentSessionIdHash: string | undefined, metadataMapper?: (metadata: Record<string, unknown> | undefined) => Record<string, unknown> | undefined): PublicSession {
  return {
    id: row.idHash,
    current: row.idHash === currentSessionIdHash,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    idleExpiresAt: row.idleExpiresAt,
    metadata: metadataMapper?.(row.metadata),
  };
}

function paginate<T>(rows: T[], page: PageInput | undefined, id: (row: T) => string): Page<T> & { map<U>(map: (item: T) => U): Page<U> } {
  const limit = Math.min(200, Math.max(1, page?.limit ?? 50));
  const start = page?.cursor ? Math.max(0, rows.findIndex((row) => id(row) === page.cursor) + 1) : 0;
  const items = rows.slice(start, start + limit);
  const next = rows[start + limit];
  return {
    items,
    ...(next ? { nextCursor: id(items.at(-1)!) } : {}),
    map<U>(map: (item: T) => U): Page<U> {
      return { items: items.map(map), ...(next ? { nextCursor: id(items.at(-1)!) } : {}) };
    },
  };
}

const dangerousObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

function strictObject(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw errors.inputInvalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw errors.inputInvalid({ field: "body" });
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (dangerousObjectKeys.has(key) || !allowedKeys.includes(key)) throw errors.inputInvalid({ field: key });
  }
  return record;
}

function optionalObject(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return strictObject(value, allowedKeys);
}

function requiredStringObject(value: unknown, key: string, allowedKeys: readonly string[], maximumLength: number): Record<string, string> {
  const result = strictObject(value, allowedKeys);
  const field = result[key];
  if (typeof field !== "string" || !field.trim() || field.length > maximumLength) throw errors.inputInvalid({ field: key });
  return result as Record<string, string>;
}

function parsePageInput(value: unknown): PageInput {
  const result = optionalObject(value, ["cursor", "limit"]);
  if (result.cursor !== undefined && (typeof result.cursor !== "string" || result.cursor.length > 512)) throw errors.inputInvalid({ field: "cursor" });
  if (result.limit !== undefined && (!Number.isInteger(result.limit) || (result.limit as number) < 1 || (result.limit as number) > 200)) throw errors.inputInvalid({ field: "limit" });
  return { ...(typeof result.cursor === "string" ? { cursor: result.cursor } : {}), ...(typeof result.limit === "number" ? { limit: result.limit } : {}) };
}

function parseAuditInput(value: unknown): { userId?: string; action?: string; cursor?: string; limit?: number } {
  const result = optionalObject(value, ["userId", "action", "cursor", "limit"]);
  for (const key of ["userId", "action", "cursor"] as const) {
    const field = result[key];
    if (field !== undefined && (typeof field !== "string" || field.length > 512)) throw errors.inputInvalid({ field: key });
  }
  if (result.limit !== undefined && (!Number.isInteger(result.limit) || (result.limit as number) < 1 || (result.limit as number) > 200)) throw errors.inputInvalid({ field: "limit" });
  return result as { userId?: string; action?: string; cursor?: string; limit?: number };
}

function parseMetricQuery(value: unknown): MetricQuery {
  const result = optionalObject(value, ["names", "from", "to", "dimensions", "limit", "order"]);
  if (result.names !== undefined && (!Array.isArray(result.names) || result.names.length > 50 || result.names.some((item) => typeof item !== "string" || item.length > 160))) throw errors.inputInvalid({ field: "names" });
  for (const key of ["from", "to"] as const) {
    const field = result[key];
    if (field !== undefined && (typeof field !== "string" || !Number.isFinite(Date.parse(field)))) throw errors.inputInvalid({ field: key });
  }
  if (result.dimensions !== undefined) {
    const dimensions = strictObject(result.dimensions, Object.keys(result.dimensions as object));
    if (Object.keys(dimensions).length > 32 || Object.entries(dimensions).some(([key, item]) => key.length > 80 || typeof item !== "string" || item.length > 256)) throw errors.inputInvalid({ field: "dimensions" });
  }
  if (result.limit !== undefined && (!Number.isInteger(result.limit) || (result.limit as number) < 1 || (result.limit as number) > 10_000)) throw errors.inputInvalid({ field: "limit" });
  if (result.order !== undefined && result.order !== "asc" && result.order !== "desc") throw errors.inputInvalid({ field: "order" });
  return result as MetricQuery;
}

function parseRateResetInput(value: unknown): { key: string; policyName?: string } {
  const result = requiredStringObject(value, "key", ["key", "policyName"], 512);
  if (result.policyName !== undefined && (typeof result.policyName !== "string" || result.policyName.length > 160)) throw errors.inputInvalid({ field: "policyName" });
  return result as { key: string; policyName?: string };
}

function parseMaintenanceInput(value: unknown): { enabled: boolean; reason?: string; allowOwners?: boolean } {
  const result = strictObject(value, ["enabled", "reason", "allowOwners"]);
  if (typeof result.enabled !== "boolean") throw errors.inputInvalid({ field: "enabled" });
  if (result.reason !== undefined && (typeof result.reason !== "string" || result.reason.length > 500)) throw errors.inputInvalid({ field: "reason" });
  if (result.allowOwners !== undefined && typeof result.allowOwners !== "boolean") throw errors.inputInvalid({ field: "allowOwners" });
  return { enabled: result.enabled, ...(typeof result.reason === "string" ? { reason: result.reason } : {}), ...(typeof result.allowOwners === "boolean" ? { allowOwners: result.allowOwners } : {}) };
}

function parseBlockInput(value: unknown): Omit<BlockRecord, "createdAt"> {
  const result = strictObject(value, ["subjectType", "subjectId", "reason", "expiresAt"]);
  if (!["user", "guild", "ip"].includes(String(result.subjectType))) throw errors.inputInvalid({ field: "subjectType" });
  if (typeof result.subjectId !== "string" || !result.subjectId || result.subjectId.length > 512) throw errors.inputInvalid({ field: "subjectId" });
  if (typeof result.reason !== "string" || !result.reason.trim() || result.reason.length > 500) throw errors.inputInvalid({ field: "reason" });
  if (result.expiresAt !== undefined && (typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt)))) throw errors.inputInvalid({ field: "expiresAt" });
  return { subjectType: result.subjectType as BlockRecord["subjectType"], subjectId: result.subjectId, reason: result.reason, ...(typeof result.expiresAt === "string" ? { expiresAt: result.expiresAt } : {}) };
}

function parseUnblockInput(value: unknown): { subjectType: BlockRecord["subjectType"]; subjectId: string } {
  const result = strictObject(value, ["subjectType", "subjectId"]);
  if (!["user", "guild", "ip"].includes(String(result.subjectType))) throw errors.inputInvalid({ field: "subjectType" });
  if (typeof result.subjectId !== "string" || !result.subjectId || result.subjectId.length > 512) throw errors.inputInvalid({ field: "subjectId" });
  return { subjectType: result.subjectType as BlockRecord["subjectType"], subjectId: result.subjectId };
}
