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
import type { AuditStore, GuildGateStores } from "./stores.js";
import { compareAuditRowsDescending, decodeAuditCursor, encodeAuditCursor, isAfterAuditCursor } from "./audit-pagination.js";

interface RateBucket {
  count: number;
  resetAtMs: number;
}

interface LockEntry {
  token: string;
  expiresAtMs: number;
  fencingToken: number;
}

export interface MemoryStoreBundle extends GuildGateStores {
  inspect(): {
    sessions: SessionRecord[];
    audit: AuditEvent[];
    outbox: OutboxRecord[];
    blocks: BlockRecord[];
  };
  clear(): void;
}

export function createMemoryStoreBundle(): MemoryStoreBundle {
  const sessions = new Map<string, SessionRecord>();
  const states = new Map<string, OAuthStateRecord>();
  const credentials = new Map<string, OAuthCredentialRecord>();
  const rateBuckets = new Map<string, RateBucket>();
  const cache = new Map<string, CacheEntry>();
  const idempotency = new Map<string, IdempotencyRecord>();
  const locks = new Map<string, LockEntry>();
  const audit: AuditEvent[] = [];
  const outbox: OutboxRecord[] = [];
  const outboxClaims = new Map<string, { workerId: string; expiresAtMs: number }>();
  const blocks = new Map<string, BlockRecord>();
  let policyVersion = 1;
  let fencingToken = 0;
  let maintenance: MaintenanceState = {
    enabled: false,
    allowOwners: true,
    updatedAt: new Date(0).toISOString(),
  };

  const blockKey = (type: BlockRecord["subjectType"], id: string) => `${type}:${id}`;
  const credentialKey = (provider: string, userId: string) => `${provider}:${userId}`;

  async function acquireMemoryLease(key: string, token: string, ttlMs: number, waitMs: number) {
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      const now = Date.now();
      const current = locks.get(key);
      if (!current || current.expiresAtMs <= now) {
        fencingToken += 1;
        const entry = { token, expiresAtMs: now + ttlMs, fencingToken };
        locks.set(key, entry);
        return { key, token, fencingToken: entry.fencingToken, expiresAtMs: entry.expiresAtMs };
      }
      if (waitMs <= 0) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - now))));
    } while (Date.now() <= deadline);
    return null;
  }

  const bundle: MemoryStoreBundle = {
    sessions: {
      async get(idHash) {
        return sessions.get(idHash) ?? null;
      },
      async create(record, maximumSessionsPerUser) {
        sessions.set(record.idHash, structuredClone(record));
        const rows = [...sessions.values()]
          .filter((candidate) => candidate.userId === record.userId)
          .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || right.idHash.localeCompare(left.idHash));
        for (const excess of rows.slice(Math.max(1, maximumSessionsPerUser))) sessions.delete(excess.idHash);
      },
      async set(record) {
        sessions.set(record.idHash, structuredClone(record));
      },
      async delete(idHash) {
        sessions.delete(idHash);
      },
      async listByUser(userId) {
        return [...sessions.values()]
          .filter((record) => record.userId === userId)
          .map((record) => structuredClone(record));
      },
    },

    oauthStates: {
      async put(record) {
        states.set(record.stateHash, structuredClone(record));
      },
      async consume(stateHash, nowIso) {
        const record = states.get(stateHash);
        states.delete(stateHash);
        if (!record || record.expiresAt <= nowIso) return null;
        return structuredClone(record);
      },
    },

    credentials: {
      async get(provider, userId) {
        const record = credentials.get(credentialKey(provider, userId));
        return record ? structuredClone(record) : null;
      },
      async set(record) {
        credentials.set(credentialKey(record.provider, record.userId), structuredClone(record));
      },
      async delete(provider, userId) {
        credentials.delete(credentialKey(provider, userId));
      },
    },

    rateLimits: {
      async hit(input: RateLimitHitInput): Promise<RateLimitHitResult> {
        const cost = input.cost ?? 1;
        const current = rateBuckets.get(input.key);
        const bucket = !current || current.resetAtMs <= input.nowMs
          ? { count: 0, resetAtMs: input.nowMs + input.windowMs }
          : current;
        const allowed = bucket.count + cost <= input.limit;
        if (allowed) bucket.count += cost;
        rateBuckets.set(input.key, bucket);
        return {
          allowed,
          limit: input.limit,
          remaining: Math.max(0, input.limit - bucket.count),
          resetAtMs: bucket.resetAtMs,
          retryAfterMs: allowed ? 0 : Math.max(0, bucket.resetAtMs - input.nowMs),
        };
      },
      async reset(key) {
        rateBuckets.delete(key);
      },
    },

    cache: {
      async get<T>(key: string): Promise<CacheEntry<T> | null> {
        const entry = cache.get(key) as CacheEntry<T> | undefined;
        if (!entry) return null;
        if ((entry.staleUntilMs ?? entry.expiresAtMs) <= Date.now()) {
          cache.delete(key);
          return null;
        }
        return structuredClone(entry);
      },
      async set<T>(key: string, entry: CacheEntry<T>) {
        cache.set(key, structuredClone(entry));
      },
      async delete(key) {
        cache.delete(key);
      },
      async deleteByTags(tags) {
        const requested = new Set(tags);
        let deleted = 0;
        for (const [key, entry] of cache.entries()) {
          if (entry.tags.some((tag) => requested.has(tag))) {
            cache.delete(key);
            deleted += 1;
          }
        }
        return deleted;
      },
    },

    idempotency: {
      async begin(record: IdempotencyRecord): Promise<IdempotencyBeginResult> {
        if (!record.reservationId) throw new TypeError("Idempotency reservations require a reservationId");
        const current = idempotency.get(record.key);
        if (current && current.expiresAtMs > Date.now()) {
          if (current.requestHash !== record.requestHash) return { status: "conflict" };
          if (current.state === "completed") return { status: "completed", response: structuredClone(current.response) };
          return { status: "inflight" };
        }
        idempotency.set(record.key, structuredClone(record));
        return { status: "started" };
      },
      async complete(key, response, expiresAtMs, reservationId) {
        const current = idempotency.get(key);
        if (!current || current.state !== "inflight" || !reservationId || current.reservationId !== reservationId) return false;
        idempotency.set(key, {
          ...current,
          state: "completed",
          response: structuredClone(response),
          expiresAtMs,
        });
        return true;
      },
      async renew(key, expiresAtMs, reservationId) {
        const current = idempotency.get(key);
        if (!current || current.state !== "inflight" || !reservationId || current.reservationId !== reservationId) return false;
        current.expiresAtMs = expiresAtMs;
        return true;
      },
      async fail(key, reservationId) {
        const current = idempotency.get(key);
        if (!current || current.state !== "inflight" || !reservationId || current.reservationId !== reservationId) return false;
        idempotency.delete(key);
        return true;
      },
      async get(key) {
        const current = idempotency.get(key);
        if (!current || current.expiresAtMs <= Date.now()) {
          idempotency.delete(key);
          return null;
        }
        return structuredClone(current);
      },
    },

    locks: {
      async acquire(key, token, ttlMs, waitMs) {
        return Boolean(await acquireMemoryLease(key, token, ttlMs, waitMs));
      },
      acquireLease: acquireMemoryLease,
      async renew(key, token, ttlMs) {
        const current = locks.get(key);
        if (!current || current.token !== token || current.expiresAtMs <= Date.now()) return false;
        current.expiresAtMs = Date.now() + ttlMs;
        return true;
      },
      async release(key, token) {
        const current = locks.get(key);
        if (current?.token === token) locks.delete(key);
      },
    },

    audit: (() => {
      const listPage: NonNullable<AuditStore["listPage"]> = async (filter) => {
        const limit = Math.min(500, Math.max(1, filter?.limit ?? 100));
        const cursor = decodeAuditCursor(filter?.cursor);
        let rows = audit
          .filter((row) => !filter?.userId || row.actor.userId === filter.userId)
          .filter((row) => !filter?.action || row.action === filter.action)
          .sort(compareAuditRowsDescending);
        if (cursor) rows = rows.filter((row) => isAfterAuditCursor(row, cursor));
        const selected = rows.slice(0, limit + 1);
        const hasMore = selected.length > limit;
        const items = selected.slice(0, limit).map((row) => structuredClone(row));
        const last = items.at(-1);
        return {
          items,
          ...(hasMore && last ? { nextCursor: encodeAuditCursor(last) } : {}),
        };
      };
      return {
        async write(event) {
          audit.push(structuredClone(event));
        },
        async list(filter) {
          return (await listPage(filter)).items;
        },
        listPage,
      } satisfies AuditStore;
    })(),

    outbox: {
      async enqueue(record) {
        outbox.push(structuredClone(record));
      },
      async next(limit) {
        const now = Date.now();
        return outbox
          .filter((row) => !row.publishedAt && (outboxClaims.get(row.id)?.expiresAtMs ?? 0) <= now)
          .slice(0, limit)
          .map((row) => structuredClone(row));
      },
      async claim(limit, workerId, leaseMs) {
        const now = Date.now();
        const rows = outbox
          .filter((row) => !row.publishedAt && (outboxClaims.get(row.id)?.expiresAtMs ?? 0) <= now)
          .slice(0, limit);
        for (const row of rows) outboxClaims.set(row.id, { workerId, expiresAtMs: now + leaseMs });
        return rows.map((row) => structuredClone(row));
      },
      async markPublished(id, publishedAt) {
        const row = outbox.find((item) => item.id === id);
        if (row) row.publishedAt = publishedAt;
        outboxClaims.delete(id);
      },
      async markFailed(id, error) {
        const row = outbox.find((item) => item.id === id);
        if (row) {
          row.attempts += 1;
          row.lastError = error;
        }
        outboxClaims.delete(id);
      },
    },

    policies: {
      async getMaintenance() {
        return structuredClone(maintenance);
      },
      async setMaintenance(state) {
        maintenance = structuredClone(state);
      },
      async getBlock(subjectType, subjectId, nowIso) {
        const record = blocks.get(blockKey(subjectType, subjectId));
        if (!record) return null;
        if (record.expiresAt && record.expiresAt <= nowIso) {
          blocks.delete(blockKey(subjectType, subjectId));
          return null;
        }
        return structuredClone(record);
      },
      async putBlock(record) {
        blocks.set(blockKey(record.subjectType, record.subjectId), structuredClone(record));
      },
      async removeBlock(subjectType, subjectId) {
        blocks.delete(blockKey(subjectType, subjectId));
      },
      async listBlocks(filter) {
        let rows = [...blocks.values()];
        if (filter?.subjectType) rows = rows.filter((row) => row.subjectType === filter.subjectType);
        return rows.slice(0, filter?.limit ?? 100).map((row) => structuredClone(row));
      },
      async getPolicyVersion() {
        return policyVersion;
      },
      async bumpPolicyVersion() {
        policyVersion += 1;
        return policyVersion;
      },
    },

    inspect() {
      return {
        sessions: [...sessions.values()].map((row) => structuredClone(row)),
        audit: audit.map((row) => structuredClone(row)),
        outbox: outbox.map((row) => structuredClone(row)),
        blocks: [...blocks.values()].map((row) => structuredClone(row)),
      };
    },

    clear() {
      sessions.clear();
      states.clear();
      credentials.clear();
      rateBuckets.clear();
      cache.clear();
      idempotency.clear();
      locks.clear();
      audit.length = 0;
      outbox.length = 0;
      outboxClaims.clear();
      blocks.clear();
      policyVersion = 1;
      fencingToken = 0;
      maintenance = { enabled: false, allowOwners: true, updatedAt: new Date(0).toISOString() };
    },
  };

  return bundle;
}
