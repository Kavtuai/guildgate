import type {
  AuditEvent,
  BlockRecord,
  CacheEntry,
  IdempotencyBeginResult,
  IdempotencyRecord,
  MaintenanceState,
  OAuthCredentialRecord,
  OAuthStateRecord,
  OutboxRecord,
  RateLimitHitInput,
  RateLimitHitResult,
  SessionRecord,
} from "./types.js";

export interface SessionStore {
  get(idHash: string): Promise<SessionRecord | null>;
  create?(record: SessionRecord, maximumSessionsPerUser: number): Promise<void>;
  set(record: SessionRecord): Promise<void>;
  delete(idHash: string): Promise<void>;
  listByUser(userId: string): Promise<SessionRecord[]>;
}

export interface OAuthStateStore {
  put(record: OAuthStateRecord): Promise<void>;
  consume(stateHash: string, nowIso: string): Promise<OAuthStateRecord | null>;
}

export interface OAuthCredentialStore {
  get(provider: string, userId: string): Promise<OAuthCredentialRecord | null>;
  set(record: OAuthCredentialRecord): Promise<void>;
  delete(provider: string, userId: string): Promise<void>;
}

export interface RateLimitStore {
  hit(input: RateLimitHitInput): Promise<RateLimitHitResult>;
  reset(key: string): Promise<void>;
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByTags(tags: string[]): Promise<number>;
}

export interface IdempotencyStore {
  begin(record: IdempotencyRecord): Promise<IdempotencyBeginResult>;
  complete(key: string, response: unknown, expiresAtMs: number, reservationId?: string): Promise<boolean | void>;
  renew?(key: string, expiresAtMs: number, reservationId?: string): Promise<boolean>;
  fail(key: string, reservationId?: string): Promise<boolean | void>;
  get(key: string): Promise<IdempotencyRecord | null>;
}

export interface LockStore {
  acquire(key: string, token: string, ttlMs: number, waitMs: number): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
  acquireLease?(key: string, token: string, ttlMs: number, waitMs: number): Promise<{ key: string; token: string; fencingToken: number; expiresAtMs: number } | null>;
  renew?(key: string, token: string, ttlMs: number): Promise<boolean>;
}

export interface AuditPage {
  items: AuditEvent[];
  nextCursor?: string;
}

export interface AuditListFilter {
  userId?: string;
  action?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditStore {
  write(event: AuditEvent): Promise<void>;
  list?(filter?: Omit<AuditListFilter, "cursor">): Promise<AuditEvent[]>;
  listPage?(filter?: AuditListFilter): Promise<AuditPage>;
}

export interface OutboxStore {
  enqueue(record: OutboxRecord): Promise<void>;
  next(limit: number): Promise<OutboxRecord[]>;
  claim?(limit: number, workerId: string, leaseMs: number): Promise<OutboxRecord[]>;
  markPublished(id: string, publishedAt: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

export interface PolicyStore {
  getMaintenance(): Promise<MaintenanceState>;
  setMaintenance(state: MaintenanceState): Promise<void>;
  getBlock(subjectType: BlockRecord["subjectType"], subjectId: string, nowIso: string): Promise<BlockRecord | null>;
  putBlock(record: BlockRecord): Promise<void>;
  removeBlock(subjectType: BlockRecord["subjectType"], subjectId: string): Promise<void>;
  listBlocks?(filter?: { subjectType?: BlockRecord["subjectType"]; limit?: number }): Promise<BlockRecord[]>;
  getPolicyVersion(): Promise<number>;
  bumpPolicyVersion(): Promise<number>;
}

export interface GuildGateStores {
  sessions: SessionStore;
  oauthStates: OAuthStateStore;
  credentials: OAuthCredentialStore;
  rateLimits: RateLimitStore;
  cache: CacheStore;
  idempotency: IdempotencyStore;
  locks: LockStore;
  audit: AuditStore;
  outbox: OutboxStore;
  policies: PolicyStore;
}

export function composeStores(base: GuildGateStores, overrides: Partial<GuildGateStores>): GuildGateStores {
  return { ...base, ...overrides };
}
