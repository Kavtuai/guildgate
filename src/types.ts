export type EnvironmentName = "development" | "test" | "production";
export type SupportedLocale = "en" | "tr";
export type HttpMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface SessionRecord {
  idHash: string;
  userId: string;
  locale: SupportedLocale;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  rotateAfter: string;
  revokedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface OAuthStateRecord {
  stateHash: string;
  returnTo: string;
  locale: SupportedLocale;
  createdAt: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

export interface OAuthCredentialRecord {
  provider: "discord" | string;
  userId: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  scope: string;
  tokenType: string;
  expiresAt: string;
  updatedAt: string;
}

export interface AuditActor {
  type: "user" | "owner" | "system" | "anonymous";
  userId?: string;
  sessionIdHash?: string;
}

export interface ResourceRef {
  type: string;
  id: string;
}

export interface AuditEvent {
  id: string;
  requestId: string;
  action: string;
  actor: AuditActor;
  resource?: ResourceRef;
  result: "success" | "denied" | "failed";
  reasonCode?: string;
  policyVersion: number;
  changes?: unknown;
  metadata: {
    ipHash?: string;
    userAgent?: string;
    durationMs: number;
  };
  createdAt: string;
}

export interface RealtimeEvent<T = unknown> {
  version: 1;
  id: string;
  sequence?: number;
  event: string;
  channel: string;
  timestamp: string;
  data: T;
}

export interface OutboxRecord {
  id: string;
  event: RealtimeEvent;
  createdAt: string;
  publishedAt?: string;
  attempts: number;
  lastError?: string;
}

export interface BlockRecord {
  subjectType: "user" | "guild" | "ip";
  subjectId: string;
  reason: string;
  createdAt: string;
  expiresAt?: string;
}

export interface MaintenanceState {
  enabled: boolean;
  reason?: string;
  allowOwners: boolean;
  updatedAt: string;
}

export interface RateLimitHitInput {
  key: string;
  limit: number;
  windowMs: number;
  nowMs: number;
  cost?: number;
}

export interface RateLimitHitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterMs: number;
}

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAtMs: number;
  staleUntilMs?: number;
  tags: string[];
}

export type IdempotencyState = "inflight" | "completed";

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  reservationId?: string;
  state: IdempotencyState;
  response?: unknown;
  createdAtMs: number;
  expiresAtMs: number;
}

export type IdempotencyBeginResult =
  | { status: "started" }
  | { status: "inflight" }
  | { status: "conflict" }
  | { status: "completed"; response: unknown };

export interface RequestEnvelope {
  method: HttpMethod;
  path: string;
  input: unknown;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip?: string;
  origin?: string;
  userAgent?: string;
  requestId?: string;
  locale?: SupportedLocale | string;
  sessionToken?: string;
  csrfToken?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface SessionResolution {
  session: SessionRecord | null;
  replacementToken?: string;
  replacementCsrfToken?: string;
  clearCookie?: boolean;
}

export interface PostCommitIssue {
  stage: "transaction-hook" | "cache" | "realtime" | "audit";
  code: string;
}

export interface ActionExecutionMeta {
  requestId: string;
  locale: SupportedLocale;
  rateLimit?: RateLimitHitResult;
  replacementSessionToken?: string;
  replacementCsrfToken?: string;
  clearSessionCookie?: boolean;
  postCommitIssues?: PostCommitIssue[];
}

export type ActionExecutionResult<T> =
  | { ok: true; data: T; meta: ActionExecutionMeta }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        status: number;
        retryable: boolean;
        details?: Record<string, unknown>;
      };
      meta: ActionExecutionMeta;
    };
