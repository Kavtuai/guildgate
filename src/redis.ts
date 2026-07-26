import type {
  CacheStore,
  IdempotencyStore,
  OAuthStateStore,
  RateLimitStore,
  SessionStore,
} from "./stores.js";
import type { LeaseLockStore } from "./locks.js";
import type {
  CacheEntry,
  IdempotencyBeginResult,
  IdempotencyRecord,
  OAuthStateRecord,
  RateLimitHitInput,
  RateLimitHitResult,
  SessionRecord,
} from "./types.js";

export interface RedisCommandAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { px?: number; nx?: boolean }): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  sAdd(key: string, ...members: string[]): Promise<number>;
  sRem(key: string, ...members: string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  pTtl(key: string): Promise<number>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export interface RedisEphemeralStores {
  sessions: SessionStore;
  oauthStates: OAuthStateStore;
  rateLimits: RateLimitStore;
  cache: CacheStore;
  idempotency: IdempotencyStore;
  locks: LeaseLockStore;
}

export function fromNodeRedis(client: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: Record<string, unknown>): Promise<string | null>;
  del(keys: string | string[]): Promise<number>;
  sAdd(key: string, members: string | string[]): Promise<number>;
  sRem(key: string, members: string | string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  pTTL(key: string): Promise<number>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}): RedisCommandAdapter {
  return {
    get: (key) => client.get(key),
    async set(key, value, options) {
      const result = await client.set(key, value, {
        ...(options?.px ? { PX: options.px } : {}),
        ...(options?.nx ? { NX: true } : {}),
      });
      return result === "OK";
    },
    del: (...keys) => client.del(keys),
    sAdd: (key, ...members) => client.sAdd(key, members),
    sRem: (key, ...members) => client.sRem(key, members),
    sMembers: (key) => client.sMembers(key),
    pTtl: (key) => client.pTTL(key),
    eval: (script, keys, args) => client.eval(script, { keys, arguments: args }),
  };
}

export function fromIoRedis(client: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: string[]): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  pttl(key: string): Promise<number>;
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}): RedisCommandAdapter {
  return {
    get: (key) => client.get(key),
    async set(key, value, options) {
      const args: string[] = [];
      if (options?.px) args.push("PX", String(options.px));
      if (options?.nx) args.push("NX");
      return await client.set(key, value, ...args) === "OK";
    },
    del: (...keys) => client.del(...keys),
    sAdd: (key, ...members) => client.sadd(key, ...members),
    sRem: (key, ...members) => client.srem(key, ...members),
    sMembers: (key) => client.smembers(key),
    pTtl: (key) => client.pttl(key),
    eval: (script, keys, args) => client.eval(script, keys.length, ...keys, ...args),
  };
}

export function createRedisEphemeralStores(redis: RedisCommandAdapter, input?: { prefix?: string }): RedisEphemeralStores {
  const prefix = input?.prefix ?? "guildgate";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/.test(prefix)) throw new TypeError("Redis prefix is invalid");
  const key = (kind: string, id: string) => `${prefix}:${kind}:${id}`;

  const sessions: SessionStore = {
    async get(idHash) {
      return parse<SessionRecord>(await redis.get(key("session", idHash)));
    },
    async set(record) {
      const ttl = Math.max(1, new Date(record.expiresAt).getTime() - Date.now());
      await redis.set(key("session", record.idHash), JSON.stringify(record), { px: ttl });
      await redis.sAdd(key("user-sessions", record.userId), record.idHash);
    },
    async delete(idHash) {
      const record = await sessions.get(idHash);
      await redis.del(key("session", idHash));
      if (record) await redis.sRem(key("user-sessions", record.userId), idHash);
    },
    async listByUser(userId) {
      const ids = await redis.sMembers(key("user-sessions", userId));
      const rows = await Promise.all(ids.map((id) => sessions.get(id)));
      const missing = ids.filter((_, index) => !rows[index]);
      if (missing.length) await redis.sRem(key("user-sessions", userId), ...missing);
      return rows.filter((row): row is SessionRecord => Boolean(row));
    },
  };

  const oauthStates: OAuthStateStore = {
    async put(record) {
      const ttl = Math.max(1, new Date(record.expiresAt).getTime() - Date.now());
      await redis.set(key("oauth-state", record.stateHash), JSON.stringify(record), { px: ttl });
    },
    async consume(stateHash, nowIso) {
      const raw = await redis.eval(GET_AND_DELETE_SCRIPT, [key("oauth-state", stateHash)], []);
      if (typeof raw !== "string") return null;
      const record = parse<OAuthStateRecord>(raw);
      return record && record.expiresAt > nowIso ? record : null;
    },
  };

  const rateLimits: RateLimitStore = {
    async hit(hit: RateLimitHitInput): Promise<RateLimitHitResult> {
      const result = await redis.eval(RATE_LIMIT_SCRIPT, [key("rate", hit.key)], [
        String(hit.cost ?? 1),
        String(hit.limit),
        String(hit.windowMs),
      ]);
      const [allowed, count, ttl] = asNumberArray(result);
      return {
        allowed: allowed === 1,
        limit: hit.limit,
        remaining: Math.max(0, hit.limit - count),
        resetAtMs: hit.nowMs + ttl,
        retryAfterMs: allowed === 1 ? 0 : ttl,
      };
    },
    async reset(rateKey) {
      await redis.del(key("rate", rateKey));
    },
  };

  const cache: CacheStore = {
    async get<T>(cacheKey: string): Promise<CacheEntry<T> | null> {
      return parse<CacheEntry<T>>(await redis.get(key("cache", cacheKey)));
    },
    async set<T>(cacheKey: string, entry: CacheEntry<T>) {
      const ttl = Math.max(1, (entry.staleUntilMs ?? entry.expiresAtMs) - Date.now());
      const storageKey = key("cache", cacheKey);
      await redis.set(storageKey, JSON.stringify(entry), { px: ttl });
      for (const tag of entry.tags) await redis.sAdd(key("cache-tag", tag), cacheKey);
    },
    async delete(cacheKey) {
      const storageKey = key("cache", cacheKey);
      const entry = parse<CacheEntry>(await redis.get(storageKey));
      await redis.del(storageKey);
      if (entry) {
        for (const tag of entry.tags) await redis.sRem(key("cache-tag", tag), cacheKey);
      }
    },
    async deleteByTags(tags) {
      const ids = new Set<string>();
      for (const tag of tags) {
        for (const id of await redis.sMembers(key("cache-tag", tag))) ids.add(id);
      }
      await Promise.all([...ids].map((id) => cache.delete(id)));
      await Promise.all(tags.map((tag) => redis.del(key("cache-tag", tag))));
      return ids.size;
    },
  };

  const idempotency: IdempotencyStore = {
    async begin(record: IdempotencyRecord): Promise<IdempotencyBeginResult> {
      const result = await redis.eval(IDEMPOTENCY_BEGIN_SCRIPT, [key("idempotency", record.key)], [
        JSON.stringify(record),
        record.requestHash,
        String(Math.max(1, record.expiresAtMs - Date.now())),
      ]);
      if (!Array.isArray(result)) throw new Error("Unexpected Redis idempotency response");
      const status = String(result[0]);
      if (status === "started") return { status: "started" };
      if (status === "inflight") return { status: "inflight" };
      if (status === "conflict") return { status: "conflict" };
      if (status === "completed") {
        const existing = parse<IdempotencyRecord>(String(result[1]));
        return { status: "completed", response: existing?.response };
      }
      throw new Error(`Unknown idempotency status: ${status}`);
    },
    async complete(idempotencyKey, response, expiresAtMs) {
      const storageKey = key("idempotency", idempotencyKey);
      const record = parse<IdempotencyRecord>(await redis.get(storageKey));
      if (!record) return;
      await redis.set(storageKey, JSON.stringify({ ...record, state: "completed", response, expiresAtMs }), {
        px: Math.max(1, expiresAtMs - Date.now()),
      });
    },
    async fail(idempotencyKey) {
      await redis.del(key("idempotency", idempotencyKey));
    },
    async get(idempotencyKey) {
      return parse<IdempotencyRecord>(await redis.get(key("idempotency", idempotencyKey)));
    },
  };

  const locks: LeaseLockStore = {
    async acquire(lockKey, token, ttlMs, waitMs) {
      return Boolean(await this.acquireLease(lockKey, token, ttlMs, waitMs));
    },
    async acquireLease(lockKey, token, ttlMs, waitMs) {
      const deadline = Date.now() + Math.max(0, waitMs);
      do {
        const result = await redis.eval(LEASE_ACQUIRE_SCRIPT, [key("lock", lockKey), key("lock-fence", lockKey)], [token, String(ttlMs)]);
        if (Array.isArray(result) && Number(result[0]) === 1) {
          return { key: lockKey, token, fencingToken: Number(result[1]), expiresAtMs: Date.now() + ttlMs };
        }
        if (waitMs <= 0) return null;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() <= deadline);
      return null;
    },
    async renew(lockKey, token, ttlMs) {
      return Number(await redis.eval(COMPARE_AND_RENEW_SCRIPT, [key("lock", lockKey)], [token, String(ttlMs)])) === 1;
    },
    async release(lockKey, token) {
      await redis.eval(COMPARE_AND_DELETE_SCRIPT, [key("lock", lockKey)], [token]);
    },
  };

  return { sessions, oauthStates, rateLimits, cache, idempotency, locks };
}

const GET_AND_DELETE_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value
`;

const RATE_LIMIT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local count = tonumber(current or '0')
local cost = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
if not current then redis.call('PSETEX', KEYS[1], window, '0') end
local allowed = 0
if count + cost <= limit then
  count = redis.call('INCRBY', KEYS[1], cost)
  allowed = 1
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], window); ttl = window end
return {allowed, count, ttl}
`;

const LEASE_ACQUIRE_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then
  local fence = redis.call('INCR', KEYS[2])
  return {1, fence}
end
return {0, 0}
`;

const COMPARE_AND_RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const COMPARE_AND_DELETE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const IDEMPOTENCY_BEGIN_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then
  redis.call('PSETEX', KEYS[1], ARGV[3], ARGV[1])
  return {'started'}
end
local decoded = cjson.decode(existing)
if decoded.requestHash ~= ARGV[2] then return {'conflict'} end
if decoded.state == 'completed' then return {'completed', existing} end
return {'inflight'}
`;

function parse<T>(value: string | null): T | null {
  if (!value) return null;
  return JSON.parse(value) as T;
}

function asNumberArray(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) throw new Error("Unexpected Redis script response");
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}
