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
  pExpire?(key: string, ttlMs: number): Promise<boolean>;
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
  pExpire?(key: string, milliseconds: number): Promise<boolean | number>;
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
    pExpire: client.pExpire ? async (key, ttlMs) => Boolean(await client.pExpire!(key, ttlMs)) : undefined,
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
  pexpire?(key: string, milliseconds: number): Promise<number>;
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
    pExpire: client.pexpire ? async (key, ttlMs) => (await client.pexpire!(key, ttlMs)) === 1 : undefined,
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
    async create(record, maximumSessionsPerUser) {
      const ttl = Math.max(1, new Date(record.expiresAt).getTime() - Date.now());
      await redis.eval(SESSION_CREATE_SCRIPT, [key("session", record.idHash), key("user-sessions", record.userId)], [
        JSON.stringify(record),
        String(ttl),
        record.idHash,
        String(Math.max(1, maximumSessionsPerUser)),
        key("session", ""),
      ]);
    },
    async set(record) {
      const ttl = Math.max(1, new Date(record.expiresAt).getTime() - Date.now());
      await redis.set(key("session", record.idHash), JSON.stringify(record), { px: ttl });
      const userSessionsKey = key("user-sessions", record.userId);
      await redis.sAdd(userSessionsKey, record.idHash);
      const currentTtl = await redis.pTtl(userSessionsKey);
      if (currentTtl < ttl) {
        if (redis.pExpire) await redis.pExpire(userSessionsKey, ttl);
        else await redis.eval("return redis.call('PEXPIRE', KEYS[1], ARGV[1])", [userSessionsKey], [String(ttl)]);
      }
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
      await redis.eval(CACHE_SET_SCRIPT, [key("cache", cacheKey)], [
        JSON.stringify(entry),
        String(ttl),
        cacheKey,
        key("cache-tag", ""),
      ]);
    },
    async delete(cacheKey) {
      await redis.eval(CACHE_DELETE_SCRIPT, [key("cache", cacheKey)], [cacheKey, key("cache-tag", "")]);
    },
    async deleteByTags(tags) {
      const requested = new Set(tags);
      const candidates = new Map<string, Set<string>>();
      for (const tag of requested) {
        for (const id of await redis.sMembers(key("cache-tag", tag))) {
          const matched = candidates.get(id) ?? new Set<string>();
          matched.add(tag);
          candidates.set(id, matched);
        }
      }
      let deleted = 0;
      for (const [id, sourceTags] of candidates) {
        const entry = await cache.get(id);
        if (entry && entry.tags.some((tag) => requested.has(tag))) {
          await cache.delete(id);
          deleted += 1;
          continue;
        }
        for (const tag of sourceTags) await redis.sRem(key("cache-tag", tag), id);
      }
      for (const tag of requested) {
        const tagKey = key("cache-tag", tag);
        if ((await redis.sMembers(tagKey)).length === 0) await redis.del(tagKey);
      }
      return deleted;
    },
  };

  const idempotency: IdempotencyStore = {
    async begin(record: IdempotencyRecord): Promise<IdempotencyBeginResult> {
      if (!record.reservationId) throw new TypeError("Idempotency reservations require a reservationId");
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
    async complete(idempotencyKey, response, expiresAtMs, reservationId) {
      if (!reservationId) return false;
      const completed = await redis.eval(IDEMPOTENCY_COMPLETE_SCRIPT, [key("idempotency", idempotencyKey)], [
        reservationId,
        JSON.stringify(response === undefined ? null : response),
        String(expiresAtMs),
        String(Math.max(1, expiresAtMs - Date.now())),
      ]);
      return Number(completed) === 1;
    },
    async renew(idempotencyKey, expiresAtMs, reservationId) {
      if (!reservationId) return false;
      const renewed = await redis.eval(IDEMPOTENCY_RENEW_SCRIPT, [key("idempotency", idempotencyKey)], [
        reservationId,
        String(expiresAtMs),
        String(Math.max(1, expiresAtMs - Date.now())),
      ]);
      return Number(renewed) === 1;
    },
    async fail(idempotencyKey, reservationId) {
      if (!reservationId) return false;
      const deleted = await redis.eval(IDEMPOTENCY_FAIL_SCRIPT, [key("idempotency", idempotencyKey)], [reservationId]);
      return Number(deleted) === 1;
    },
    async get(idempotencyKey) {
      return parse<IdempotencyRecord>(await redis.get(key("idempotency", idempotencyKey)));
    },
  };

  const acquireRedisLease: NonNullable<LeaseLockStore["acquireLease"]> = async (lockKey, token, ttlMs, waitMs) => {
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
  };

  const locks: LeaseLockStore = {
    async acquire(lockKey, token, ttlMs, waitMs) {
      return Boolean(await acquireRedisLease(lockKey, token, ttlMs, waitMs));
    },
    acquireLease: acquireRedisLease,
    async renew(lockKey, token, ttlMs) {
      return Number(await redis.eval(COMPARE_AND_RENEW_SCRIPT, [key("lock", lockKey)], [token, String(ttlMs)])) === 1;
    },
    async release(lockKey, token) {
      await redis.eval(COMPARE_AND_DELETE_SCRIPT, [key("lock", lockKey)], [token]);
    },
  };

  return { sessions, oauthStates, rateLimits, cache, idempotency, locks };
}

const CACHE_SET_SCRIPT = `
local previous = redis.call('GET', KEYS[1])
local next_record = cjson.decode(ARGV[1])
local next_tags = {}
for _, tag in ipairs(next_record.tags or {}) do next_tags[tag] = true end
if previous then
  local previous_record = cjson.decode(previous)
  for _, tag in ipairs(previous_record.tags or {}) do
    if not next_tags[tag] then
      local tag_key = ARGV[4] .. tag
      redis.call('SREM', tag_key, ARGV[3])
      if redis.call('SCARD', tag_key) == 0 then redis.call('DEL', tag_key) end
    end
  end
end
redis.call('PSETEX', KEYS[1], ARGV[2], ARGV[1])
for tag, _ in pairs(next_tags) do
  local tag_key = ARGV[4] .. tag
  redis.call('SADD', tag_key, ARGV[3])
  local current_ttl = redis.call('PTTL', tag_key)
  if current_ttl < tonumber(ARGV[2]) then redis.call('PEXPIRE', tag_key, ARGV[2]) end
end
return 1
`;

const CACHE_DELETE_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then return 0 end
local record = cjson.decode(existing)
redis.call('DEL', KEYS[1])
for _, tag in ipairs(record.tags or {}) do
  local tag_key = ARGV[2] .. tag
  redis.call('SREM', tag_key, ARGV[1])
  if redis.call('SCARD', tag_key) == 0 then redis.call('DEL', tag_key) end
end
return 1
`;

const SESSION_CREATE_SCRIPT = `
redis.call('PSETEX', KEYS[1], ARGV[2], ARGV[1])
redis.call('SADD', KEYS[2], ARGV[3])
local user_ttl = redis.call('PTTL', KEYS[2])
if user_ttl < tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
local ids = redis.call('SMEMBERS', KEYS[2])
local rows = {}
for _, id in ipairs(ids) do
  local raw = redis.call('GET', ARGV[5] .. id)
  if raw then
    local record = cjson.decode(raw)
    table.insert(rows, { id = id, lastSeenAt = record.lastSeenAt or '' })
  else
    redis.call('SREM', KEYS[2], id)
  end
end
table.sort(rows, function(a, b)
  if a.lastSeenAt == b.lastSeenAt then return a.id > b.id end
  return a.lastSeenAt > b.lastSeenAt
end)
local maximum = tonumber(ARGV[4])
for index = maximum + 1, #rows do
  redis.call('DEL', ARGV[5] .. rows[index].id)
  redis.call('SREM', KEYS[2], rows[index].id)
end
return #rows
`;

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

const IDEMPOTENCY_COMPLETE_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then return 0 end
local decoded = cjson.decode(existing)
if decoded.state ~= 'inflight' or decoded.reservationId ~= ARGV[1] then return 0 end
decoded.state = 'completed'
decoded.response = cjson.decode(ARGV[2])
decoded.expiresAtMs = tonumber(ARGV[3])
redis.call('PSETEX', KEYS[1], ARGV[4], cjson.encode(decoded))
return 1
`;

const IDEMPOTENCY_RENEW_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then return 0 end
local decoded = cjson.decode(existing)
if decoded.state ~= 'inflight' or decoded.reservationId ~= ARGV[1] then return 0 end
decoded.expiresAtMs = tonumber(ARGV[2])
redis.call('PSETEX', KEYS[1], ARGV[3], cjson.encode(decoded))
return 1
`;

const IDEMPOTENCY_FAIL_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if not existing then return 0 end
local decoded = cjson.decode(existing)
if decoded.state ~= 'inflight' or decoded.reservationId ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

function parse<T>(value: string | null): T | null {
  if (!value) return null;
  return JSON.parse(value) as T;
}

function asNumberArray(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) throw new Error("Unexpected Redis script response");
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}
