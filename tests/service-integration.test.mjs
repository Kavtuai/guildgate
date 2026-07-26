import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPostgresAdapter } from "../dist/postgres.js";
import { createRedisEphemeralStores, fromNodeRedis } from "../dist/redis.js";

const enabled = process.env.GUILDGATE_SERVICE_TESTS === "1";

function sessionRecord(idHash, userId = "service-user") {
  const now = new Date();
  return {
    idHash,
    userId,
    locale: "en",
    createdAt: now.toISOString(),
    lastSeenAt: new Date(now.getTime() + Number(idHash.replace(/\D/g, "") || 0)).toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    idleExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    rotateAfter: new Date(now.getTime() + 30_000).toISOString(),
  };
}

test("PostgreSQL adapter enforces transaction, reservation, paging and session invariants", { skip: !enabled }, async (context) => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  const prefix = `ggci${Date.now()}${Math.floor(Math.random() * 10_000)}`.slice(0, 38);
  const adapter = createPostgresAdapter({ pool, prefix });

  context.after(async () => {
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE $1", [`${prefix}_%`]);
    for (const row of tables.rows) await pool.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
    await pool.query(`DROP SEQUENCE IF EXISTS "${prefix}_lock_fencing_seq" CASCADE`);
    await pool.end();
  });

  await adapter.migrate();

  const hooks = [];
  const committed = await adapter.transactions.run({}, async (outer) => {
    outer.afterCommit(() => hooks.push("outer"));
    await adapter.transactions.run({}, async (inner) => {
      inner.afterCommit(() => hooks.push("inner"));
      return true;
    });
    return 42;
  });
  assert.equal(committed, 42);
  assert.deepEqual(hooks, ["outer", "inner"]);

  const key = `idem-${randomUUID()}`;
  const now = Date.now();
  assert.deepEqual(await adapter.stores.idempotency.begin({
    key,
    requestHash: "hash",
    reservationId: "owner-current",
    state: "inflight",
    createdAtMs: now,
    expiresAtMs: now + 60_000,
  }), { status: "started" });
  assert.equal(await adapter.stores.idempotency.renew(key, now + 120_000, "owner-old"), false);
  assert.equal(await adapter.stores.idempotency.renew(key, now + 120_000, "owner-current"), true);
  assert.equal(await adapter.stores.idempotency.complete(key, { stale: true }, now + 60_000, "owner-old"), false);
  assert.equal(await adapter.stores.idempotency.fail(key, "owner-old"), false);
  assert.equal(await adapter.stores.idempotency.complete(key, { committed: true }, now + 60_000, "owner-current"), true);
  assert.deepEqual((await adapter.stores.idempotency.get(key))?.response, { committed: true });

  await Promise.all(Array.from({ length: 12 }, (_, index) => adapter.stores.sessions.create?.(sessionRecord(`session-${index}`), 3)));
  assert.equal((await adapter.stores.sessions.listByUser("service-user")).length, 3);

  const rateKey = `rate-${randomUUID()}`;
  const rateResults = await Promise.all(Array.from({ length: 20 }, () => adapter.stores.rateLimits.hit({
    key: rateKey,
    limit: 5,
    windowMs: 60_000,
    nowMs: Date.now(),
  })));
  assert.equal(rateResults.filter((result) => result.allowed).length, 5);

  const createdAt = new Date().toISOString();
  for (let index = 0; index < 31; index += 1) {
    await adapter.stores.audit.write({
      id: String(index).padStart(4, "0"),
      requestId: `request-${index}`,
      action: "service.audit",
      actor: { type: "system" },
      result: "success",
      policyVersion: 1,
      metadata: { durationMs: index },
      createdAt,
    });
  }
  const observed = [];
  let cursor;
  do {
    const page = await adapter.stores.audit.listPage({ action: "service.audit", limit: 7, cursor });
    observed.push(...page.items.map((event) => event.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(observed.length, 31);
  assert.equal(new Set(observed).size, 31);
});

test("Redis adapter enforces atomic session limits, cache retagging and reservation ownership", { skip: !enabled }, async (context) => {
  const { createClient } = await import("redis");
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  const prefix = `ggci:${randomUUID()}`;
  const stores = createRedisEphemeralStores(fromNodeRedis(client), { prefix });

  context.after(async () => {
    const keys = await client.keys(`${prefix}:*`);
    if (keys.length) await client.del(keys);
    await client.quit();
  });

  await Promise.all(Array.from({ length: 12 }, (_, index) => stores.sessions.create?.(sessionRecord(`redis-session-${index}`, "redis-user"), 3)));
  assert.equal((await stores.sessions.listByUser("redis-user")).length, 3);

  const expiresAtMs = Date.now() + 60_000;
  await stores.cache.set("item", { value: 1, expiresAtMs, tags: ["old"] });
  await stores.cache.set("item", { value: 2, expiresAtMs, tags: ["new"] });
  assert.equal(await stores.cache.deleteByTags(["old"]), 0);
  assert.equal((await stores.cache.get("item"))?.value, 2);
  assert.equal((await client.pTTL(`${prefix}:cache-tag:new`)) > 0, true);

  const key = `idem-${randomUUID()}`;
  const now = Date.now();
  assert.deepEqual(await stores.idempotency.begin({
    key,
    requestHash: "hash",
    reservationId: "owner-current",
    state: "inflight",
    createdAtMs: now,
    expiresAtMs: now + 60_000,
  }), { status: "started" });
  assert.equal(await stores.idempotency.renew(key, now + 120_000, "owner-old"), false);
  assert.equal(await stores.idempotency.renew(key, now + 120_000, "owner-current"), true);
  assert.equal(await stores.idempotency.complete(key, { stale: true }, now + 60_000, "owner-old"), false);
  assert.equal(await stores.idempotency.fail(key, "owner-old"), false);
  assert.equal(await stores.idempotency.complete(key, { committed: true }, now + 60_000, "owner-current"), true);
  assert.deepEqual((await stores.idempotency.get(key))?.response, { committed: true });
});
