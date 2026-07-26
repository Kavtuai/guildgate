import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { decodeAuditCursor, encodeAuditCursor } from "./audit-pagination.js";
import type { AnalyticsStore } from "./analytics/store.js";
import type { MetricPoint, MetricQuery } from "./analytics/types.js";
import type { LeaseLockStore, LockLease } from "./locks.js";
import type { RealtimeEventLog } from "./realtime/sequence.js";
import type {
  AuditStore,
  CacheStore,
  GuildGateStores,
  IdempotencyStore,
  OAuthCredentialStore,
  OAuthStateStore,
  OutboxStore,
  PolicyStore,
  RateLimitStore,
  SessionStore,
} from "./stores.js";
import { runPostCommitCallbacks, runRollbackCallbacks, type TransactionAdapter, type TransactionOptions, type TransactionScope } from "./transactions.js";
import type {
  AuditEvent,
  BlockRecord,
  CacheEntry,
  IdempotencyRecord,
  MaintenanceState,
  OAuthCredentialRecord,
  OAuthStateRecord,
  OutboxRecord,
  RealtimeEvent,
  SessionRecord,
} from "./types.js";

export interface PgQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface PgQueryable {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<Row>>;
}

export interface PgClientLike extends PgQueryable {
  release?(): void;
}

export interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgClientLike>;
}

export interface PostgresAdapterBundle {
  stores: GuildGateStores;
  transactions: TransactionAdapter;
  analytics: AnalyticsStore;
  eventLog: RealtimeEventLog;
  migrate(): Promise<void>;
  migrationSql: string;
}

export function createPostgresAdapter(input: { pool: PgPoolLike; prefix?: string }): PostgresAdapterBundle {
  const prefix = input.prefix ?? "guildgate";
  if (!/^[a-z][a-z0-9_]{0,40}$/i.test(prefix)) throw new TypeError("PostgreSQL table prefix is invalid");
  const table = (name: string) => `"${prefix}_${name}"`;
  const sequence = `"${prefix}_lock_fencing_seq"`;
  interface TransactionContext {
    client: PgClientLike;
    options: TransactionOptions;
    afterCommit: Array<() => void | Promise<void>>;
    afterRollback: Array<(error: unknown) => void | Promise<void>>;
  }

  const txStorage = new AsyncLocalStorage<TransactionContext>();
  const q = <Row = Record<string, unknown>>(text: string, values?: unknown[]) => (txStorage.getStore()?.client ?? input.pool).query<Row>(text, values);

  const transactions: TransactionAdapter = {
    async run<T>(options: TransactionOptions, work: (scope: TransactionScope) => Promise<T>): Promise<T> {
      const parent = txStorage.getStore();
      if (parent) return runNestedTransaction(parent, options, work);

      const client = await input.pool.connect();
      const context: TransactionContext = { client, options, afterCommit: [], afterRollback: [] };
      const scope = createScope(client, options, "postgres", context.afterCommit, context.afterRollback);
      let result!: T;
      let committed = false;

      try {
        try {
          await client.query("BEGIN");
          if (options.isolation) await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationSql(options.isolation)}`);
          if (options.readOnly) await client.query("SET TRANSACTION READ ONLY");
          if (options.timeoutMs) await client.query("SELECT set_config('statement_timeout', $1, true)", [String(Math.max(1, options.timeoutMs))]);
          result = await txStorage.run(context, () => work(scope));
          await client.query("COMMIT");
          committed = true;
        } catch (error) {
          if (!committed) await client.query("ROLLBACK").catch(() => undefined);
          await runRollbackCallbacks(context.afterRollback, error);
          throw error;
        }

        await runPostCommitCallbacks(context.afterCommit, options, result);
        return result;
      } finally {
        client.release?.();
      }
    },
  };

  async function runNestedTransaction<T>(
    parent: TransactionContext,
    options: TransactionOptions,
    work: (scope: TransactionScope) => Promise<T>,
  ): Promise<T> {
    assertNestedOptions(parent.options, options);
    const savepoint = `guildgate_${randomUUID().replaceAll("-", "")}`;
    const afterCommit: Array<() => void | Promise<void>> = [];
    const afterRollback: Array<(error: unknown) => void | Promise<void>> = [];
    const scope = createScope(parent.client, options, "postgres-savepoint", afterCommit, afterRollback);
    await parent.client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await work(scope);
      await parent.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      parent.afterCommit.push(...afterCommit);
      parent.afterRollback.push(...afterRollback);
      return result;
    } catch (error) {
      await parent.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => undefined);
      await parent.client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => undefined);
      await runRollbackCallbacks(afterRollback, error);
      throw error;
    }
  }

  function assertNestedOptions(parent: TransactionOptions, nested: TransactionOptions): void {
    if (nested.isolation && nested.isolation !== (parent.isolation ?? "read-committed")) {
      throw new TypeError("Nested PostgreSQL transactions cannot change the isolation level");
    }
    if (nested.readOnly !== undefined && nested.readOnly !== (parent.readOnly ?? false)) {
      throw new TypeError("Nested PostgreSQL transactions cannot change readOnly mode");
    }
  }

  const sessions: SessionStore = {
    async get(idHash) {
      const result = await q<{ record: SessionRecord }>(`SELECT record FROM ${table("sessions")} WHERE id_hash=$1`, [idHash]);
      return result.rows[0]?.record ?? null;
    },
    async create(record, maximumSessionsPerUser) {
      await transactions.run({ name: "session-create" }, async () => {
        await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [record.userId]);
        await q(`INSERT INTO ${table("sessions")} (id_hash,user_id,last_seen_at,expires_at,record) VALUES ($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT (id_hash) DO UPDATE SET user_id=EXCLUDED.user_id,last_seen_at=EXCLUDED.last_seen_at,expires_at=EXCLUDED.expires_at,record=EXCLUDED.record`,
        [record.idHash, record.userId, record.lastSeenAt, record.expiresAt, JSON.stringify(record)]);
        await q(`DELETE FROM ${table("sessions")} WHERE id_hash IN (
          SELECT id_hash FROM ${table("sessions")} WHERE user_id=$1 ORDER BY last_seen_at DESC,id_hash DESC OFFSET $2
        )`, [record.userId, Math.max(1, maximumSessionsPerUser)]);
      });
    },
    async set(record) {
      await q(`INSERT INTO ${table("sessions")} (id_hash,user_id,last_seen_at,expires_at,record) VALUES ($1,$2,$3,$4,$5::jsonb)
        ON CONFLICT (id_hash) DO UPDATE SET user_id=EXCLUDED.user_id,last_seen_at=EXCLUDED.last_seen_at,expires_at=EXCLUDED.expires_at,record=EXCLUDED.record`,
      [record.idHash, record.userId, record.lastSeenAt, record.expiresAt, JSON.stringify(record)]);
    },
    async delete(idHash) { await q(`DELETE FROM ${table("sessions")} WHERE id_hash=$1`, [idHash]); },
    async listByUser(userId) {
      const result = await q<{ record: SessionRecord }>(`SELECT record FROM ${table("sessions")} WHERE user_id=$1 ORDER BY last_seen_at DESC`, [userId]);
      return result.rows.map((row) => row.record);
    },
  };

  const oauthStates: OAuthStateStore = {
    async put(record) {
      await q(`INSERT INTO ${table("oauth_states")} (state_hash,expires_at,record) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT (state_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at,record=EXCLUDED.record`, [record.stateHash, record.expiresAt, JSON.stringify(record)]);
    },
    async consume(stateHash, nowIso) {
      const result = await q<{ record: OAuthStateRecord }>(`DELETE FROM ${table("oauth_states")} WHERE state_hash=$1 AND expires_at>$2 RETURNING record`, [stateHash, nowIso]);
      return result.rows[0]?.record ?? null;
    },
  };

  const credentials: OAuthCredentialStore = {
    async get(provider, userId) {
      const result = await q<{ record: OAuthCredentialRecord }>(`SELECT record FROM ${table("credentials")} WHERE provider=$1 AND user_id=$2`, [provider, userId]);
      return result.rows[0]?.record ?? null;
    },
    async set(record) {
      await q(`INSERT INTO ${table("credentials")} (provider,user_id,record) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT (provider,user_id) DO UPDATE SET record=EXCLUDED.record`, [record.provider, record.userId, JSON.stringify(record)]);
    },
    async delete(provider, userId) { await q(`DELETE FROM ${table("credentials")} WHERE provider=$1 AND user_id=$2`, [provider, userId]); },
  };

  const rateLimits: RateLimitStore = {
    async hit(hit) {
      return transactions.run({ name: "rate-limit" }, async () => {
        // A row lock cannot protect the first insert because no row exists yet. The
        // transaction-scoped advisory lock serializes both first-write and update paths.
        await q("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [hit.key]);
        const current = await q<{ count: number; reset_at_ms: string }>(`SELECT count, (extract(epoch from reset_at)*1000)::bigint::text AS reset_at_ms FROM ${table("rate_limits")} WHERE key=$1`, [hit.key]);
        const now = hit.nowMs;
        const cost = hit.cost ?? 1;
        const row = current.rows[0];
        let count = row ? Number(row.count) : 0;
        let resetAtMs = row ? Number(row.reset_at_ms) : now + hit.windowMs;
        if (!row || resetAtMs <= now) { count = 0; resetAtMs = now + hit.windowMs; }
        const allowed = count + cost <= hit.limit;
        if (allowed) count += cost;
        await q(`INSERT INTO ${table("rate_limits")} (key,count,reset_at) VALUES ($1,$2,to_timestamp($3/1000.0))
          ON CONFLICT (key) DO UPDATE SET count=EXCLUDED.count,reset_at=EXCLUDED.reset_at`, [hit.key, count, resetAtMs]);
        return { allowed, limit: hit.limit, remaining: Math.max(0, hit.limit - count), resetAtMs, retryAfterMs: allowed ? 0 : Math.max(0, resetAtMs - now) };
      });
    },
    async reset(key) { await q(`DELETE FROM ${table("rate_limits")} WHERE key=$1`, [key]); },
  };

  const cache: CacheStore = {
    async get<T>(key: string) {
      const result = await q<{ entry: CacheEntry<T> }>(`SELECT entry FROM ${table("cache")} WHERE key=$1 AND stale_until>now()`, [key]);
      return result.rows[0]?.entry ?? null;
    },
    async set<T>(key: string, entry: CacheEntry<T>) {
      await q(`INSERT INTO ${table("cache")} (key,expires_at,stale_until,tags,entry) VALUES ($1,to_timestamp($2/1000.0),to_timestamp($3/1000.0),$4,$5::jsonb)
        ON CONFLICT (key) DO UPDATE SET expires_at=EXCLUDED.expires_at,stale_until=EXCLUDED.stale_until,tags=EXCLUDED.tags,entry=EXCLUDED.entry`,
      [key, entry.expiresAtMs, entry.staleUntilMs ?? entry.expiresAtMs, entry.tags, JSON.stringify(entry)]);
    },
    async delete(key) { await q(`DELETE FROM ${table("cache")} WHERE key=$1`, [key]); },
    async deleteByTags(tags) {
      const result = await q(`DELETE FROM ${table("cache")} WHERE tags && $1::text[]`, [tags]);
      return result.rowCount ?? 0;
    },
  };

  const idempotency: IdempotencyStore = {
    async begin(record) {
      if (!record.reservationId) throw new TypeError("Idempotency reservations require a reservationId");
      return transactions.run({ name: "idempotency-begin" }, async () => {
        const inserted = await q(`INSERT INTO ${table("idempotency")} (key,expires_at,record) VALUES ($1,to_timestamp($2/1000.0),$3::jsonb)
          ON CONFLICT (key) DO NOTHING RETURNING key`, [record.key, record.expiresAtMs, JSON.stringify(record)]);
        if ((inserted.rowCount ?? inserted.rows.length) > 0) return { status: "started" as const };

        const existing = await q<{ record: IdempotencyRecord; expired: boolean }>(`SELECT record,(expires_at<=now()) AS expired FROM ${table("idempotency")} WHERE key=$1 FOR UPDATE`, [record.key]);
        const row = existing.rows[0];
        if (!row || row.expired) {
          await q(`UPDATE ${table("idempotency")} SET expires_at=to_timestamp($2/1000.0),record=$3::jsonb WHERE key=$1`, [record.key, record.expiresAtMs, JSON.stringify(record)]);
          return { status: "started" as const };
        }
        if (row.record.requestHash !== record.requestHash) return { status: "conflict" as const };
        if (row.record.state === "completed") return { status: "completed" as const, response: row.record.response };
        return { status: "inflight" as const };
      });
    },
    async complete(key, response, expiresAtMs, reservationId) {
      if (!reservationId) return false;
      const responseJson = JSON.stringify(response === undefined ? null : response);
      const result = await q(`UPDATE ${table("idempotency")}
        SET expires_at=to_timestamp($2/1000.0),
            record=jsonb_set(jsonb_set(jsonb_set(record,'{state}','"completed"'::jsonb,true),'{response}',$3::jsonb,true),'{expiresAtMs}',to_jsonb($2::bigint),true)
        WHERE key=$1 AND expires_at>now() AND record->>'state'='inflight' AND record->>'reservationId'=$4
        RETURNING key`, [key, expiresAtMs, responseJson, reservationId]);
      return (result.rowCount ?? result.rows.length) > 0;
    },
    async renew(key, expiresAtMs, reservationId) {
      if (!reservationId) return false;
      const result = await q(`UPDATE ${table("idempotency")}
        SET expires_at=to_timestamp($2/1000.0),
            record=jsonb_set(record,'{expiresAtMs}',to_jsonb($2::bigint),true)
        WHERE key=$1 AND expires_at>now() AND record->>'state'='inflight' AND record->>'reservationId'=$3
        RETURNING key`, [key, expiresAtMs, reservationId]);
      return (result.rowCount ?? result.rows.length) > 0;
    },
    async fail(key, reservationId) {
      if (!reservationId) return false;
      const result = await q(`DELETE FROM ${table("idempotency")} WHERE key=$1 AND record->>'state'='inflight' AND record->>'reservationId'=$2`, [key, reservationId]);
      return (result.rowCount ?? 0) > 0;
    },
    async get(key) {
      const result = await q<{ record: IdempotencyRecord }>(`SELECT record FROM ${table("idempotency")} WHERE key=$1 AND expires_at>now()`, [key]);
      return result.rows[0]?.record ?? null;
    },
  };

  const acquirePostgresLease: NonNullable<LeaseLockStore["acquireLease"]> = async (key, token, ttlMs, waitMs) => {
    const deadline = Date.now() + Math.max(0, waitMs);
    do {
      const result = await q<{ fencing_token: string; expires_at_ms: string }>(`INSERT INTO ${table("locks")} (key,token,fencing_token,expires_at)
        VALUES ($1,$2,nextval('${sequence}'),now()+($3::text||' milliseconds')::interval)
        ON CONFLICT (key) DO UPDATE SET token=EXCLUDED.token,fencing_token=EXCLUDED.fencing_token,expires_at=EXCLUDED.expires_at
        WHERE ${table("locks")}.expires_at<=now()
        RETURNING fencing_token::text,(extract(epoch from expires_at)*1000)::bigint::text AS expires_at_ms`, [key, token, ttlMs]);
      const row = result.rows[0];
      if (row) return { key, token, fencingToken: Number(row.fencing_token), expiresAtMs: Number(row.expires_at_ms) } satisfies LockLease;
      if (waitMs <= 0) return null;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() <= deadline);
    return null;
  };

  const locks: LeaseLockStore = {
    async acquire(key, token, ttlMs, waitMs) { return Boolean(await acquirePostgresLease(key, token, ttlMs, waitMs)); },
    acquireLease: acquirePostgresLease,
    async renew(key, token, ttlMs) {
      const result = await q(`UPDATE ${table("locks")} SET expires_at=now()+($3::text||' milliseconds')::interval WHERE key=$1 AND token=$2 AND expires_at>now()`, [key, token, ttlMs]);
      return (result.rowCount ?? 0) > 0;
    },
    async release(key, token) { await q(`DELETE FROM ${table("locks")} WHERE key=$1 AND token=$2`, [key, token]); },
  };

  const listAuditPage: NonNullable<AuditStore["listPage"]> = async (filter) => {
    const limit = Math.min(500, Math.max(1, filter?.limit ?? 100));
    const cursor = decodeAuditCursor(filter?.cursor);
    const values: unknown[] = [];
    const where: string[] = [];
    if (filter?.userId) { values.push(filter.userId); where.push(`user_id=$${values.length}`); }
    if (filter?.action) { values.push(filter.action); where.push(`action=$${values.length}`); }
    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      where.push(`(created_at,id)<($${values.length - 1}::timestamptz,$${values.length}::text)`);
    }
    values.push(limit + 1);
    const result = await q<{ event: AuditEvent }>(`SELECT event FROM ${table("audit")} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`, values);
    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map((row) => row.event);
    const last = items.at(-1);
    return { items, ...(hasMore && last ? { nextCursor: encodeAuditCursor(last) } : {}) };
  };

  const audit: AuditStore = {
    async write(event) {
      await q(`INSERT INTO ${table("audit")} (id,user_id,action,created_at,event) VALUES ($1,$2,$3,$4,$5::jsonb)`, [event.id, event.actor.userId ?? null, event.action, event.createdAt, JSON.stringify(event)]);
    },
    async list(filter) {
      return (await listAuditPage(filter)).items;
    },
    listPage: listAuditPage,
  };

  const outbox = createOutboxStore(q, table);

  const policies: PolicyStore = {
    async getMaintenance() {
      const result = await q<{ value: MaintenanceState }>(`SELECT value FROM ${table("policies")} WHERE key='maintenance'`);
      return result.rows[0]?.value ?? { enabled: false, allowOwners: true, updatedAt: new Date(0).toISOString() };
    },
    async setMaintenance(state) {
      await q(`INSERT INTO ${table("policies")} (key,value) VALUES ('maintenance',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(state)]);
    },
    async getBlock(subjectType, subjectId, nowIso) {
      const result = await q<{ record: BlockRecord }>(`SELECT record FROM ${table("blocks")} WHERE subject_type=$1 AND subject_id=$2 AND (expires_at IS NULL OR expires_at>$3)`, [subjectType, subjectId, nowIso]);
      return result.rows[0]?.record ?? null;
    },
    async putBlock(record) {
      await q(`INSERT INTO ${table("blocks")} (subject_type,subject_id,expires_at,record) VALUES ($1,$2,$3,$4::jsonb)
        ON CONFLICT (subject_type,subject_id) DO UPDATE SET expires_at=EXCLUDED.expires_at,record=EXCLUDED.record`, [record.subjectType, record.subjectId, record.expiresAt ?? null, JSON.stringify(record)]);
    },
    async removeBlock(subjectType, subjectId) { await q(`DELETE FROM ${table("blocks")} WHERE subject_type=$1 AND subject_id=$2`, [subjectType, subjectId]); },
    async getPolicyVersion() {
      const result = await q<{ value: { version?: number } }>(`SELECT value FROM ${table("policies")} WHERE key='version'`);
      return result.rows[0]?.value.version ?? 1;
    },
    async bumpPolicyVersion() {
      const result = await q<{ value: { version: number } }>(`INSERT INTO ${table("policies")} (key,value) VALUES ('version','{"version":2}'::jsonb)
        ON CONFLICT (key) DO UPDATE SET value=jsonb_build_object('version',COALESCE((${table("policies")}.value->>'version')::int,1)+1) RETURNING value`);
      return result.rows[0]?.value.version ?? 1;
    },
  };

  const writeMetricPoints: AnalyticsStore["writeMany"] = async (points) => {
    if (!points.length) return;
    const values: unknown[] = [];
    const rows = points.map((point) => {
      const offset = values.length;
      values.push(point.name, point.value, point.kind, point.timestamp, JSON.stringify(point.dimensions ?? {}));
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5}::jsonb)`;
    });
    await q(`INSERT INTO ${table("metrics")} (name,value,kind,recorded_at,dimensions) VALUES ${rows.join(",")}`, values);
  };

  const analytics: AnalyticsStore = {
    async write(point) { await writeMetricPoints([point]); },
    writeMany: writeMetricPoints,
    async query(query: MetricQuery) {
      const values: unknown[] = [];
      const where: string[] = [];
      if (query.names?.length) { values.push(query.names); where.push(`name=ANY($${values.length}::text[])`); }
      if (query.from) { values.push(query.from); where.push(`recorded_at>=$${values.length}`); }
      if (query.to) { values.push(query.to); where.push(`recorded_at<=$${values.length}`); }
      if (query.dimensions) { values.push(JSON.stringify(query.dimensions)); where.push(`dimensions @> $${values.length}::jsonb`); }
      values.push(Math.min(100_000, query.limit ?? 10_000));
      const result = await q<{ name: string; value: number; kind: MetricPoint["kind"]; timestamp: string; dimensions: Record<string, string> }>(`SELECT name,value,kind,recorded_at::text AS timestamp,dimensions FROM ${table("metrics")} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY recorded_at ${query.order === "desc" ? "DESC" : "ASC"} LIMIT $${values.length}`, values);
      return result.rows;
    },
    async deleteBefore(timestamp, names) {
      const result = names?.length
        ? await q(`DELETE FROM ${table("metrics")} WHERE recorded_at<$1 AND name=ANY($2::text[])`, [timestamp, names])
        : await q(`DELETE FROM ${table("metrics")} WHERE recorded_at<$1`, [timestamp]);
      return result.rowCount ?? 0;
    },
  };

  const eventLog: RealtimeEventLog = {
    async append(event) {
      return transactions.run({ name: "realtime-sequence" }, async () => {
        const result = await q<{ sequence: string }>(`INSERT INTO ${table("sequences")} (channel,value) VALUES ($1,1)
          ON CONFLICT (channel) DO UPDATE SET value=${table("sequences")}.value+1 RETURNING value::text AS sequence`, [event.channel]);
        const sequenceValue = Number(result.rows[0]?.sequence ?? 1);
        const sequenced = { ...event, sequence: sequenceValue };
        await q(`INSERT INTO ${table("realtime_events")} (channel,sequence,event,created_at) VALUES ($1,$2,$3::jsonb,$4)`, [event.channel, sequenceValue, JSON.stringify(sequenced), event.timestamp]);
        return sequenced;
      });
    },
    async replay(channel, afterSequence, limit) {
      const result = await q<{ event: RealtimeEvent }>(`SELECT event FROM ${table("realtime_events")} WHERE channel=$1 AND sequence>$2 ORDER BY sequence ASC LIMIT $3`, [channel, afterSequence, Math.min(5_000, limit)]);
      return result.rows.map((row) => row.event);
    },
    async latestSequence(channel) {
      const result = await q<{ value: string }>(`SELECT value::text FROM ${table("sequences")} WHERE channel=$1`, [channel]);
      return Number(result.rows[0]?.value ?? 0);
    },
    async trim(channel, beforeSequence) {
      const result = await q(`DELETE FROM ${table("realtime_events")} WHERE channel=$1 AND sequence<$2`, [channel, beforeSequence]);
      return result.rowCount ?? 0;
    },
  };

  const stores: GuildGateStores = { sessions, oauthStates, credentials, rateLimits, cache, idempotency, locks, audit, outbox, policies };
  const migrationSql = buildPostgresMigration(prefix);
  return { stores, transactions, analytics, eventLog, migrationSql, migrate: async () => { await input.pool.query(migrationSql); } };
}

function createOutboxStore(q: PgQueryable["query"], table: (name: string) => string): OutboxStore & {
  claim(limit: number, workerId: string, leaseMs: number): Promise<OutboxRecord[]>;
} {
  return {
    async enqueue(record) {
      await q(`INSERT INTO ${table("outbox")} (id,created_at,record) VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO NOTHING`, [record.id, record.createdAt, JSON.stringify(record)]);
    },
    async next(limit) {
      const result = await q<{ record: OutboxRecord }>(`SELECT record FROM ${table("outbox")} WHERE published_at IS NULL AND (claimed_until IS NULL OR claimed_until<=now()) ORDER BY created_at LIMIT $1`, [limit]);
      return result.rows.map((row) => row.record);
    },
    async claim(limit, workerId, leaseMs) {
      const result = await q<{ record: OutboxRecord }>(`WITH candidates AS (
        SELECT id FROM ${table("outbox")} WHERE published_at IS NULL AND (claimed_until IS NULL OR claimed_until<=now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
      ) UPDATE ${table("outbox")} o SET claimed_by=$2,claimed_until=now()+($3::text||' milliseconds')::interval FROM candidates c WHERE o.id=c.id RETURNING o.record`, [limit, workerId, leaseMs]);
      return result.rows.map((row) => row.record);
    },
    async markPublished(id, publishedAt) { await q(`UPDATE ${table("outbox")} SET published_at=$2,claimed_by=NULL,claimed_until=NULL,record=jsonb_set(record,'{publishedAt}',to_jsonb($2::text),true) WHERE id=$1`, [id, publishedAt]); },
    async markFailed(id, error) { await q(`UPDATE ${table("outbox")} SET claimed_by=NULL,claimed_until=NULL,record=jsonb_set(jsonb_set(record,'{attempts}',to_jsonb(COALESCE((record->>'attempts')::int,0)+1),true),'{lastError}',to_jsonb($2::text),true) WHERE id=$1`, [id, error]); },
  };
}

function createScope(client: PgClientLike, options: TransactionOptions, backend: string, afterCommit: Array<() => void | Promise<void>> = [], afterRollback: Array<(error: unknown) => void | Promise<void>> = []): TransactionScope {
  return {
    id: randomUUID(),
    backend,
    raw: client,
    metadata: Object.freeze({ isolation: options.isolation ?? "read-committed", readOnly: options.readOnly ?? false, name: options.name ?? "transaction" }),
    afterCommit(callback) { afterCommit.push(callback); },
    afterRollback(callback) { afterRollback.push(callback); },
  };
}

function isolationSql(isolation: NonNullable<TransactionOptions["isolation"]>): string {
  return isolation === "read-committed" ? "READ COMMITTED" : isolation === "repeatable-read" ? "REPEATABLE READ" : "SERIALIZABLE";
}

export function buildPostgresMigration(prefix = "guildgate"): string {
  if (!/^[a-z][a-z0-9_]{0,40}$/i.test(prefix)) throw new TypeError("PostgreSQL table prefix is invalid");
  const t = (name: string) => `"${prefix}_${name}"`;
  return `
CREATE SEQUENCE IF NOT EXISTS "${prefix}_lock_fencing_seq";
CREATE TABLE IF NOT EXISTS ${t("sessions")} (id_hash text PRIMARY KEY,user_id text NOT NULL,last_seen_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,record jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS "${prefix}_sessions_user_idx" ON ${t("sessions")} (user_id,last_seen_at DESC);
CREATE TABLE IF NOT EXISTS ${t("oauth_states")} (state_hash text PRIMARY KEY,expires_at timestamptz NOT NULL,record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS ${t("credentials")} (provider text NOT NULL,user_id text NOT NULL,record jsonb NOT NULL,PRIMARY KEY(provider,user_id));
CREATE TABLE IF NOT EXISTS ${t("rate_limits")} (key text PRIMARY KEY,count integer NOT NULL,reset_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS ${t("cache")} (key text PRIMARY KEY,expires_at timestamptz NOT NULL,stale_until timestamptz NOT NULL,tags text[] NOT NULL,entry jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS "${prefix}_cache_tags_idx" ON ${t("cache")} USING gin(tags);
CREATE TABLE IF NOT EXISTS ${t("idempotency")} (key text PRIMARY KEY,expires_at timestamptz NOT NULL,record jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS ${t("locks")} (key text PRIMARY KEY,token text NOT NULL,fencing_token bigint NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS ${t("audit")} (id text PRIMARY KEY,user_id text,action text NOT NULL,created_at timestamptz NOT NULL,event jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS "${prefix}_audit_query_idx" ON ${t("audit")} (created_at DESC,user_id,action);
CREATE TABLE IF NOT EXISTS ${t("outbox")} (id text PRIMARY KEY,created_at timestamptz NOT NULL,published_at timestamptz,claimed_by text,claimed_until timestamptz,record jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS "${prefix}_outbox_pending_idx" ON ${t("outbox")} (created_at) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS ${t("policies")} (key text PRIMARY KEY,value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS ${t("blocks")} (subject_type text NOT NULL,subject_id text NOT NULL,expires_at timestamptz,record jsonb NOT NULL,PRIMARY KEY(subject_type,subject_id));
CREATE TABLE IF NOT EXISTS ${t("metrics")} (id bigserial PRIMARY KEY,name text NOT NULL,value double precision NOT NULL,kind text NOT NULL,recorded_at timestamptz NOT NULL,dimensions jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX IF NOT EXISTS "${prefix}_metrics_query_idx" ON ${t("metrics")} (name,recorded_at DESC);
CREATE INDEX IF NOT EXISTS "${prefix}_metrics_dimensions_idx" ON ${t("metrics")} USING gin(dimensions);
CREATE TABLE IF NOT EXISTS ${t("sequences")} (channel text PRIMARY KEY,value bigint NOT NULL);
CREATE TABLE IF NOT EXISTS ${t("realtime_events")} (channel text NOT NULL,sequence bigint NOT NULL,event jsonb NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(channel,sequence));
`;
}
