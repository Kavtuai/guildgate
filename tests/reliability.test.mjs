import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  CacheManager,
  DistributedLockManager,
  createMemoryStoreBundle,
  errors,
  createMemoryTransactionAdapter,
  isDeadlineExceededError,
  isOperationAbortedError,
  runWithDeadline,
  validateAllowedOrigins,
} from "../dist/index.js";
import { createGuildGateTestHarness } from "../dist/testing.js";
import { createPostgresAdapter } from "../dist/postgres.js";
import { createRedisEphemeralStores } from "../dist/redis.js";
import {
  MemorySessionRevocationBus,
  attachSocketIo,
  bindRevocationBus,
  createOutboxWorker,
  createRealtimeHub,
  dispatchOutbox,
} from "../dist/realtime.js";
import { createFastifyHandler } from "../dist/fastify.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("afterCommit failures never run rollback callbacks after a committed memory transaction", async () => {
  const adapter = createMemoryTransactionAdapter();
  const calls = [];
  await assert.rejects(
    adapter.run({}, async (scope) => {
      scope.afterRollback(() => calls.push("rollback"));
      scope.afterCommit(() => {
        calls.push("afterCommit");
        throw new Error("post-commit failure");
      });
      calls.push("work");
      return 42;
    }),
    (error) => error?.name === "TransactionPostCommitError" && error.committed === true && error.result === 42,
  );
  assert.deepEqual(calls, ["work", "afterCommit"]);
});

test("post-commit reporters preserve committed PostgreSQL results and do not issue rollback", async () => {
  const statements = [];
  const reported = [];
  const client = {
    async query(text) { statements.push(text); return { rows: [] }; },
    release() { statements.push("RELEASE"); },
  };
  const pool = {
    async query(text) { statements.push(text); return { rows: [] }; },
    async connect() { return client; },
  };
  const adapter = createPostgresAdapter({ pool, prefix: "gg" });
  const result = await adapter.transactions.run({
    onPostCommitError(error, callbackIndex) { reported.push({ error, callbackIndex }); },
  }, async (scope) => {
    scope.afterRollback(() => statements.push("ROLLBACK_CALLBACK"));
    scope.afterCommit(() => { throw new Error("observer unavailable"); });
    return { committed: true };
  });

  assert.deepEqual(result, { committed: true });
  assert.equal(reported.length, 1);
  assert.equal(reported[0].callbackIndex, 0);
  assert.equal(statements.includes("COMMIT"), true);
  assert.equal(statements.includes("ROLLBACK"), false);
  assert.equal(statements.includes("ROLLBACK_CALLBACK"), false);
});

test("nested PostgreSQL transactions use savepoints and defer afterCommit until the outer commit", async () => {
  const statements = [];
  const hooks = [];
  const client = {
    async query(text) { statements.push(text); return { rows: [] }; },
    release() {},
  };
  const pool = { async query(text) { statements.push(text); return { rows: [] }; }, async connect() { return client; } };
  const adapter = createPostgresAdapter({ pool, prefix: "gg" });

  const result = await adapter.transactions.run({}, async (outer) => {
    outer.afterCommit(() => hooks.push("outer"));
    const nested = await adapter.transactions.run({}, async (inner) => {
      inner.afterCommit(() => hooks.push("inner"));
      return 7;
    });
    assert.deepEqual(hooks, []);
    return nested + 1;
  });

  assert.equal(result, 8);
  assert.deepEqual(hooks, ["outer", "inner"]);
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements.some((text) => text.startsWith("SAVEPOINT guildgate_")), true);
  assert.equal(statements.some((text) => text.startsWith("RELEASE SAVEPOINT guildgate_")), true);
  assert.equal(statements.includes("COMMIT"), true);
});

test("nested PostgreSQL rollback is limited to its savepoint", async () => {
  const statements = [];
  const rollbackHooks = [];
  const client = {
    async query(text) { statements.push(text); return { rows: [] }; },
    release() {},
  };
  const pool = { async query(text) { statements.push(text); return { rows: [] }; }, async connect() { return client; } };
  const adapter = createPostgresAdapter({ pool, prefix: "gg" });

  const result = await adapter.transactions.run({}, async () => {
    await assert.rejects(adapter.transactions.run({}, async (scope) => {
      scope.afterRollback(() => rollbackHooks.push("inner"));
      throw new Error("nested failure");
    }), /nested failure/);
    return "outer committed";
  });

  assert.equal(result, "outer committed");
  assert.deepEqual(rollbackHooks, ["inner"]);
  assert.equal(statements.some((text) => text.startsWith("ROLLBACK TO SAVEPOINT guildgate_")), true);
  assert.equal(statements.includes("ROLLBACK"), false);
  assert.equal(statements.includes("COMMIT"), true);
});

test("idempotency reservations reject stale completion and stale cleanup", async () => {
  const stores = createMemoryStoreBundle();
  const now = Date.now();
  const record = {
    key: "operation",
    requestHash: "hash",
    reservationId: "owner-one",
    state: "inflight",
    createdAtMs: now,
    expiresAtMs: now + 10_000,
  };
  assert.equal((await stores.idempotency.begin(record)).status, "started");
  assert.equal(await stores.idempotency.complete(record.key, { stale: true }, now + 10_000, "owner-two"), false);
  assert.equal(await stores.idempotency.fail(record.key, "owner-two"), false);
  assert.equal((await stores.idempotency.get(record.key))?.state, "inflight");
  assert.equal(await stores.idempotency.complete(record.key, { ok: true }, now + 10_000, "owner-one"), true);
  assert.deepEqual((await stores.idempotency.get(record.key))?.response, { ok: true });
});

test("hard deadlines return promptly even when the operation ignores AbortSignal", async () => {
  const started = Date.now();
  let error;
  try {
    await runWithDeadline({
      timeoutMs: 15,
      execute: async () => {
        await wait(90);
        return "late-result";
      },
    });
  } catch (caught) {
    error = caught;
  }
  const elapsed = Date.now() - started;
  assert.equal(isDeadlineExceededError(error), true);
  assert.equal(elapsed < 70, true, `deadline returned after ${elapsed}ms`);
  assert.deepEqual(await error.settlement, { status: "fulfilled", value: "late-result" });
});

test("parent cancellation returns promptly while preserving late settlement", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("client disconnected")), 15);
  const started = Date.now();
  let error;
  try {
    await runWithDeadline({
      timeoutMs: 500,
      parentSignal: controller.signal,
      execute: async () => {
        await wait(90);
        return "late-after-abort";
      },
    });
  } catch (caught) {
    error = caught;
  }
  const elapsed = Date.now() - started;
  assert.equal(isOperationAbortedError(error), true);
  assert.equal(elapsed < 70, true, `cancellation returned after ${elapsed}ms`);
  assert.deepEqual(await error.settlement, { status: "fulfilled", value: "late-after-abort" });
});

test("parent cancellation during retry delay returns REQUEST_ABORTED", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("client disconnected")), 20);
  await assert.rejects(runWithDeadline({
    timeoutMs: 1_000,
    parentSignal: controller.signal,
    retry: { attempts: 3, baseDelayMs: 500, maximumDelayMs: 500 },
    execute: async () => { throw errors.upstreamUnavailable(); },
  }), (error) => error?.code === "REQUEST_ABORTED");
});

test("a cancelled idempotent action records its late committed result for replay", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  const controller = new AbortController();
  let executions = 0;
  const action = harness.kernel.action({
    name: "reliability.cancelled-late-commit",
    timeoutMs: 500,
    idempotency: { ttlMs: 1_000 },
    async execute() {
      executions += 1;
      await wait(70);
      return { saved: true, executions };
    },
  });
  const request = harness.request({
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
    idempotencyKey: "cancelled-late-key",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(new Error("client disconnected")), 15);
  const first = await harness.kernel.execute(action, request);
  assert.equal(first.ok, false);
  assert.equal(first.error.code, "REQUEST_ABORTED");
  await wait(100);
  const replay = await harness.kernel.execute(action, harness.request({
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
    idempotencyKey: "cancelled-late-key",
  }));
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, { saved: true, executions: 1 });
  assert.equal(executions, 1);
});

test("idempotency renewal preserves ownership beyond the original TTL", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  let executions = 0;
  const action = harness.kernel.action({
    name: "reliability.renewed-late-commit",
    timeoutMs: 15,
    idempotency: { ttlMs: 30 },
    async execute() {
      executions += 1;
      await wait(100);
      return { saved: true, executions };
    },
  });
  const request = harness.request({
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
    idempotencyKey: "renewed-late-key",
  });
  const first = await harness.kernel.execute(action, request);
  assert.equal(first.ok, false);
  assert.equal(first.error.code, "UPSTREAM_TIMEOUT");
  const storeKey =
    "guildgate:idempotency:user-1:reliability.renewed-late-commit:renewed-late-key";
  const completionDeadline = Date.now() + 750;
  let record = await harness.stores.idempotency.get(storeKey);
  while (record?.state !== "completed" && Date.now() < completionDeadline) {
    await wait(5);
    record = await harness.stores.idempotency.get(storeKey);
  }
  assert.equal(record?.state, "completed");
  const replay = await harness.kernel.execute(action, request);  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, { saved: true, executions: 1 });
  assert.equal(executions, 1);
});

test("a timed-out idempotent action records its late committed result for replay", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  let executions = 0;
  const action = harness.kernel.action({
    name: "reliability.late-commit",
    timeoutMs: 15,
    idempotency: { ttlMs: 500 },
    async execute() {
      executions += 1;
      await wait(70);
      return { saved: true, executions };
    },
  });
  const request = harness.request({ sessionToken: login.sessionToken, csrfToken: login.csrfToken, idempotencyKey: "late-key" });
  const first = await harness.kernel.execute(action, request);
  assert.equal(first.ok, false);
  assert.equal(first.error.code, "UPSTREAM_TIMEOUT");
  const storeKey =
    "guildgate:idempotency:user-1:reliability.late-commit:late-key";
  const completionDeadline = Date.now() + 750;
  let record = await harness.stores.idempotency.get(storeKey);
  while (record?.state !== "completed" && Date.now() < completionDeadline) {
    await wait(5);
    record = await harness.stores.idempotency.get(storeKey);
  }
  assert.equal(record?.state, "completed");
  const replay = await harness.kernel.execute(action, request);  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, { saved: true, executions: 1 });
  assert.equal(executions, 1);
});

test("audit cursor pagination reaches every later row without duplicates", async () => {
  const stores = createMemoryStoreBundle();
  const createdAt = new Date().toISOString();
  for (let index = 0; index < 125; index += 1) {
    await stores.audit.write({
      id: String(index).padStart(4, "0"),
      requestId: `request-${index}`,
      action: "audit.bulk",
      actor: { type: "system" },
      result: "success",
      policyVersion: 1,
      metadata: { index },
      createdAt,
    });
  }
  const ids = [];
  let cursor;
  do {
    const page = await stores.audit.listPage({ action: "audit.bulk", limit: 17, cursor });
    ids.push(...page.items.map((event) => event.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 125);
  assert.equal(new Set(ids).size, 125);
  assert.equal(ids[0], "0124");
  assert.equal(ids.at(-1), "0000");
});

function createFakeRedis() {
  const values = new Map();
  const sets = new Map();
  const expirations = new Map();
  return {
    values,
    sets,
    expirations,
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); return true; },
    async del(...keys) { let count = 0; for (const key of keys) { count += values.delete(key) ? 1 : 0; sets.delete(key); expirations.delete(key); } return count; },
    async sAdd(key, ...members) { const set = sets.get(key) ?? new Set(); const before = set.size; members.forEach((member) => set.add(member)); sets.set(key, set); return set.size - before; },
    async sRem(key, ...members) { const set = sets.get(key) ?? new Set(); let count = 0; members.forEach((member) => { if (set.delete(member)) count += 1; }); sets.set(key, set); return count; },
    async sMembers(key) { return [...(sets.get(key) ?? [])]; },
    async pTtl(key) { return expirations.get(key) ?? -1; },
    async pExpire(key, ttlMs) { expirations.set(key, ttlMs); return true; },
    async eval(script, keys, args) {
      if (script.includes("local fence = redis.call('INCR'")) {
        if (values.has(keys[0])) return [0, 0];
        values.set(keys[0], args[0]);
        expirations.set(keys[0], Number(args[1]));
        const fence = Number(values.get(keys[1]) ?? "0") + 1;
        values.set(keys[1], String(fence));
        return [1, fence];
      }
      if (script.includes("local next_record = cjson.decode")) {
        const previous = values.get(keys[0]);
        const next = JSON.parse(args[0]);
        const nextTags = new Set(next.tags ?? []);
        if (previous) {
          for (const tag of JSON.parse(previous).tags ?? []) {
            if (!nextTags.has(tag)) {
              const tagKey = `${args[3]}${tag}`;
              const set = sets.get(tagKey) ?? new Set();
              set.delete(args[2]);
              if (set.size) sets.set(tagKey, set); else sets.delete(tagKey);
            }
          }
        }
        values.set(keys[0], args[0]);
        expirations.set(keys[0], Number(args[1]));
        for (const tag of nextTags) {
          const tagKey = `${args[3]}${tag}`;
          const set = sets.get(tagKey) ?? new Set();
          set.add(args[2]);
          sets.set(tagKey, set);
          expirations.set(tagKey, Math.max(expirations.get(tagKey) ?? -1, Number(args[1])));
        }
        return 1;
      }
      if (script.includes("local record = cjson.decode(existing)") && script.includes("SCARD")) {
        const existing = values.get(keys[0]);
        if (!existing) return 0;
        const record = JSON.parse(existing);
        values.delete(keys[0]);
        for (const tag of record.tags ?? []) {
          const tagKey = `${args[1]}${tag}`;
          const set = sets.get(tagKey) ?? new Set();
          set.delete(args[0]);
          if (set.size) sets.set(tagKey, set); else sets.delete(tagKey);
        }
        return 1;
      }
      if (script.includes("decoded.expiresAtMs = tonumber") && !script.includes("decoded.response")) {
        const raw = values.get(keys[0]);
        if (!raw) return 0;
        const record = JSON.parse(raw);
        if (record.state !== "inflight" || record.reservationId !== args[0]) return 0;
        record.expiresAtMs = Number(args[1]);
        values.set(keys[0], JSON.stringify(record));
        expirations.set(keys[0], Number(args[2]));
        return 1;
      }
      if (script.includes("decoded.state ~= 'inflight'") && script.includes("decoded.response")) {
        const raw = values.get(keys[0]);
        if (!raw) return 0;
        const record = JSON.parse(raw);
        if (record.state !== "inflight" || record.reservationId !== args[0]) return 0;
        record.state = "completed";
        record.response = JSON.parse(args[1]);
        record.expiresAtMs = Number(args[2]);
        values.set(keys[0], JSON.stringify(record));
        return 1;
      }
      if (script.includes("decoded.state ~= 'inflight'") && script.includes("return redis.call('DEL'")) {
        const raw = values.get(keys[0]);
        if (!raw) return 0;
        const record = JSON.parse(raw);
        if (record.state !== "inflight" || record.reservationId !== args[0]) return 0;
        values.delete(keys[0]);
        return 1;
      }
      if (script.includes("if not existing then") && script.includes("return {'started'}")) {
        const existing = values.get(keys[0]);
        if (!existing) { values.set(keys[0], args[0]); return ["started"]; }
        const decoded = JSON.parse(existing);
        if (decoded.requestHash !== args[1]) return ["conflict"];
        if (decoded.state === "completed") return ["completed", existing];
        return ["inflight"];
      }
      if (script.includes("PEXPIRE")) { expirations.set(keys[0], Number(args[0])); return 1; }
      return null;
    },
  };
}

test("Redis cache retagging removes stale membership and retains tag TTL", async () => {
  const redis = createFakeRedis();
  const stores = createRedisEphemeralStores(redis, { prefix: "gg" });
  const expiresAtMs = Date.now() + 60_000;
  await stores.cache.set("item", { value: 1, expiresAtMs, tags: ["old"] });
  await stores.cache.set("item", { value: 2, expiresAtMs, tags: ["new"] });
  assert.deepEqual(await redis.sMembers("gg:cache-tag:old"), []);
  assert.deepEqual(await redis.sMembers("gg:cache-tag:new"), ["item"]);
  assert.equal((redis.expirations.get("gg:cache-tag:new") ?? 0) > 0, true);
  assert.equal(await stores.cache.deleteByTags(["old"]), 0);
  assert.equal((await stores.cache.get("item"))?.value, 2);
});

test("Redis idempotency compare-and-set protects a newer reservation", async () => {
  const redis = createFakeRedis();
  const stores = createRedisEphemeralStores(redis, { prefix: "gg" });
  const now = Date.now();
  const record = { key: "key", requestHash: "hash", reservationId: "current", state: "inflight", createdAtMs: now, expiresAtMs: now + 60_000 };
  assert.equal((await stores.idempotency.begin(record)).status, "started");
  assert.equal(await stores.idempotency.renew("key", now + 120_000, "old"), false);
  assert.equal(await stores.idempotency.renew("key", now + 120_000, "current"), true);
  assert.equal(await stores.idempotency.complete("key", { stale: true }, now + 60_000, "old"), false);
  assert.equal(await stores.idempotency.fail("key", "old"), false);
  assert.equal(await stores.idempotency.complete("key", undefined, now + 60_000, "current"), true);
  assert.equal((await stores.idempotency.get("key"))?.state, "completed");
});

class FakeSocketIo {
  constructor(id = "socket-1") { this.id = id; }
  id;
  handshake = { headers: { origin: "http://localhost:3000" }, auth: {} };
  conn = { transport: { writable: true } };
  listeners = new Map();
  emitted = [];
  disconnected = false;
  emit(event, payload) { this.emitted.push({ event, payload }); }
  on(event, listener) { const rows = this.listeners.get(event) ?? []; rows.push(listener); this.listeners.set(event, rows); }
  disconnect() { this.disconnected = true; }
  clientEmit(event, ...args) { for (const listener of this.listeners.get(event) ?? []) listener(...args); }
}

test("Socket.IO traffic shares hub rate, payload, activity and backpressure controls", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  const hub = createRealtimeHub({
    sessions: harness.kernel.sessions,
    rateLimits: harness.stores.rateLimits,
    allowedOrigins: ["http://localhost:3000"],
    heartbeatIntervalMs: 10,
    idleTimeoutMs: 35,
    messagesPerWindow: 10,
    messageWindowMs: 1_000,
    maximumBufferedBytes: 10,
  });
  const socket = new FakeSocketIo();
  socket.handshake.auth.sessionToken = login.sessionToken;
  const attached = await attachSocketIo({ socket, hub, authorize: async () => true });
  socket.clientEmit("guildgate:heartbeat", {}, () => undefined);
  await wait(25);
  assert.equal(socket.disconnected, false);
  socket.clientEmit("guildgate:subscribe", { channel: "guild:1" }, () => undefined);
  await wait(10);
  socket.conn.transport.writable = false;
  await hub.publish({ version: 1, id: "event", event: "update", channel: "guild:1", timestamp: new Date().toISOString(), data: {} });
  assert.equal(socket.disconnected, true);
  attached.close();
  hub.close();
});

test("expired sessions request cookie clearing in action metadata", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z");
  const harness = createGuildGateTestHarness({
    clock: { now: () => new Date(now) },
    security: { cookie: { maxAgeSeconds: 1 }, session: { ttlMs: 100, idleTimeoutMs: 100, rotateAfterMs: 50, maximumSessionsPerUser: 5 } },
  });
  const login = await harness.login();
  now = new Date("2026-01-01T00:00:01.000Z");
  const action = harness.kernel.action({ name: "session.expired", csrf: "disabled", async execute() { return true; } });
  const result = await harness.kernel.execute(action, harness.request({ method: "GET", sessionToken: login.sessionToken }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SESSION_EXPIRED");
  assert.equal(result.meta.clearSessionCookie, true);
});

test("production origin validation rejects IPv4, IPv6 and mapped loopback hosts", () => {
  for (const origin of ["https://localhost", "https://127.0.0.1", "https://[::1]", "https://[::]", "https://[::ffff:127.0.0.1]"]) {
    assert.throws(() => validateAllowedOrigins([origin], "production"), /loopback or unspecified host/);
  }
  assert.deepEqual([...validateAllowedOrigins(["https://dashboard.example.com"], "production")], ["https://dashboard.example.com"]);
});

test("atomic memory session creation enforces the configured maximum", async () => {
  const harness = createGuildGateTestHarness({ security: { session: { maximumSessionsPerUser: 3 } } });
  await Promise.all(Array.from({ length: 20 }, () => harness.login("same-user")));
  const sessions = await harness.kernel.sessions.list("same-user");
  assert.equal(sessions.length, 3);
});


test("Socket.IO rejects oversized messages through the shared hub guard", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  const hub = createRealtimeHub({
    sessions: harness.kernel.sessions,
    rateLimits: harness.stores.rateLimits,
    allowedOrigins: ["http://localhost:3000"],
    maximumMessageBytes: 80,
  });
  const socket = new FakeSocketIo("oversized");
  socket.handshake.auth.sessionToken = login.sessionToken;
  const attached = await attachSocketIo({ socket, hub, authorize: async () => true });
  socket.clientEmit("guildgate:subscribe", { channel: `guild:${"x".repeat(200)}` }, () => undefined);
  await wait(10);
  assert.equal(socket.disconnected, true);
  attached.close();
  hub.close();
});

test("Socket.IO messages use the shared realtime rate limiter", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  const hub = createRealtimeHub({
    sessions: harness.kernel.sessions,
    rateLimits: harness.stores.rateLimits,
    allowedOrigins: ["http://localhost:3000"],
    messagesPerWindow: 1,
    messageWindowMs: 10_000,
  });
  const socket = new FakeSocketIo("rate-limited");
  socket.handshake.auth.sessionToken = login.sessionToken;
  const attached = await attachSocketIo({ socket, hub, authorize: async () => true });
  socket.clientEmit("guildgate:heartbeat", {}, () => undefined);
  await wait(5);
  socket.clientEmit("guildgate:heartbeat", {}, () => undefined);
  await wait(10);
  assert.equal(socket.disconnected, true);
  attached.close();
  hub.close();
});

test("Fastify handler clears an expired GuildGate session cookie", async () => {
  let now = new Date("2026-01-01T00:00:00.000Z");
  const harness = createGuildGateTestHarness({
    clock: { now: () => new Date(now) },
    security: { cookie: { maxAgeSeconds: 1 }, session: { ttlMs: 100, idleTimeoutMs: 100, rotateAfterMs: 50, maximumSessionsPerUser: 5 } },
  });
  const login = await harness.login();
  now = new Date("2026-01-01T00:00:01.000Z");
  const action = harness.kernel.action({ name: "http.expired", csrf: "disabled", async execute() { return true; } });
  const handler = createFastifyHandler(harness.kernel, action);
  const headers = new Map();
  let status;
  let payload;
  const reply = {
    code(value) { status = value; return this; },
    header(name, value) { headers.set(name.toLowerCase(), String(value)); return this; },
    send(value) { payload = value; return value; },
  };
  await handler({
    method: "GET",
    url: "/expired",
    headers: {},
    cookies: { [harness.kernel.cookie.name]: login.sessionToken },
  }, reply);
  assert.equal(status, 401);
  assert.equal(payload.error.code, "SESSION_EXPIRED");
  assert.match(headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("audit cursor validation rejects malformed and oversized values", async () => {
  const stores = createMemoryStoreBundle();
  await assert.rejects(stores.audit.listPage({ cursor: "not-a-cursor" }), (error) => error?.code === "INPUT_INVALID");
  await assert.rejects(stores.audit.listPage({ cursor: "x".repeat(1_025) }), (error) => error?.code === "INPUT_INVALID");
});

test("official adapter methods remain safe when destructured", async () => {
  const memory = createMemoryStoreBundle();
  const memoryAcquire = memory.locks.acquire;
  assert.equal(await memoryAcquire("memory", "owner", 1_000, 0), true);

  const redis = createFakeRedis();
  const redisStores = createRedisEphemeralStores(redis, { prefix: "destructured" });
  const redisAcquire = redisStores.locks.acquire;
  assert.equal(await redisAcquire("redis", "owner", 1_000, 0), true);

  const statements = [];
  const pool = {
    async query(text) {
      statements.push(text);
      if (text.includes("RETURNING fencing_token")) return { rows: [{ fencing_token: "1", expires_at_ms: String(Date.now() + 1_000) }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    async connect() { return { query: this.query.bind(this), release() {} }; },
  };
  const postgres = createPostgresAdapter({ pool, prefix: "destructured" });
  const postgresAcquire = postgres.stores.locks.acquire;
  assert.equal(await postgresAcquire("postgres", "owner", 1_000, 0), true);
  const writeMetric = postgres.analytics.write;
  await writeMetric({ name: "destructured.metric", value: 1, kind: "gauge", timestamp: new Date().toISOString() });
  assert.equal(statements.some((text) => text.includes("INSERT INTO \"destructured_metrics\"")), true);
});


test("generic lock stores are treated as unowned after their TTL", async () => {
  const entries = new Map();
  const store = {
    async acquire(key, token, ttlMs) {
      if (entries.has(key)) return false;
      entries.set(key, { token, expiresAtMs: Date.now() + ttlMs });
      return true;
    },
    async release(key, token) {
      if (entries.get(key)?.token === token) entries.delete(key);
    },
  };
  const manager = new DistributedLockManager(store);
  const held = await manager.acquire({ key: "generic-expiry", ttlMs: 100 });
  await wait(125);
  assert.throws(() => held.assertOwned(), (error) => error?.code === "LOCK_OWNERSHIP_LOST");
  await held.release();
});

test("cache fallback loads are stored when a lock cannot be acquired", async () => {
  const entries = new Map();
  const cacheStore = {
    async get(key) { return entries.get(key) ?? null; },
    async set(key, entry) { entries.set(key, structuredClone(entry)); },
    async delete(key) { entries.delete(key); },
    async deleteByTags() { return 0; },
  };
  const busyLocks = {
    async acquire() { return false; },
    async release() {},
  };
  const cache = new CacheManager(cacheStore, busyLocks);
  let loads = 0;
  const first = await cache.remember({
    key: "fallback",
    ttlMs: 1_000,
    waitMs: 0,
    async load() { loads += 1; return { value: loads }; },
  });
  const second = await cache.remember({
    key: "fallback",
    ttlMs: 1_000,
    waitMs: 0,
    async load() { loads += 1; return { value: loads }; },
  });
  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(second, { value: 1 });
  assert.equal(loads, 1);
});

test("late settlement retention is bounded for operations that never stop promptly", async () => {
  const harness = createGuildGateTestHarness({ reliability: { maximumLateSettlementMs: 25 } });
  const login = await harness.login();
  const action = harness.kernel.action({
    name: "reliability.bounded-settlement",
    timeoutMs: 10,
    idempotency: { ttlMs: 40 },
    concurrency: { key: () => "bounded-resource", ttlMs: 120, renewEveryMs: 50 },
    async execute() {
      await wait(120);
      return { saved: true };
    },
  });
  const request = harness.request({
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
    idempotencyKey: "bounded-key",
  });
  const result = await harness.kernel.execute(action, request);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UPSTREAM_TIMEOUT");
  await wait(55);
  assert.equal(await harness.stores.idempotency.get("guildgate:idempotency:user-1:reliability.bounded-settlement:bounded-key"), null);
  assert.equal(await harness.stores.locks.acquire("guildgate:lock:bounded-resource", "next-owner", 100, 0), true);
  await harness.stores.locks.release("guildgate:lock:bounded-resource", "next-owner");
  await wait(90);
});

test("audit fail-closed actions write before the transaction can commit", async () => {
  const stores = createMemoryStoreBundle();
  stores.audit.write = async () => { throw new Error("audit unavailable"); };
  let commits = 0;
  let rollbacks = 0;
  const transactions = {
    async run(_options, work) {
      const afterCommit = [];
      const afterRollback = [];
      const scope = {
        id: "fail-closed",
        backend: "test",
        metadata: Object.freeze({}),
        afterCommit(callback) { afterCommit.push(callback); },
        afterRollback(callback) { afterRollback.push(callback); },
      };
      try {
        const value = await work(scope);
        commits += 1;
        for (const callback of afterCommit) await callback();
        return value;
      } catch (error) {
        rollbacks += 1;
        await Promise.allSettled(afterRollback.map((callback) => callback(error)));
        throw error;
      }
    },
  };
  const harness = createGuildGateTestHarness({
    stores,
    transactions,
    audit: { failClosedActions: ["audit.fail-closed"] },
  });
  const login = await harness.login();
  const action = harness.kernel.action({
    name: "audit.fail-closed",
    idempotency: { ttlMs: 10_000 },
    transaction: {},
    async execute() { return { saved: true }; },
  });
  const result = await harness.kernel.execute(action, harness.request({
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
    idempotencyKey: "audit-fail-closed",
  }));
  assert.equal(result.ok, false);
  assert.equal(commits, 0);
  assert.equal(rollbacks, 1);
});

test("realtime subscription capacity is rechecked after asynchronous authorization", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  let closeCode;
  const hub = createRealtimeHub({
    sessions: harness.kernel.sessions,
    rateLimits: harness.stores.rateLimits,
    allowedOrigins: ["http://localhost:3000"],
    maximumSubscriptions: 1,
  });
  await hub.attach({
    connection: {
      id: "parallel-subscriptions",
      send() {},
      close(code) { closeCode = code; },
    },
    origin: "http://localhost:3000",
    sessionToken: login.sessionToken,
  });
  const authorize = async () => { await wait(10); return true; };
  const results = await Promise.all([
    hub.subscribe({ connectionId: "parallel-subscriptions", channel: "guild:1", authorize }),
    hub.subscribe({ connectionId: "parallel-subscriptions", channel: "guild:2", authorize }),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(closeCode, 1008);
  hub.close();
});

test("realtime delivery failures remove broken connections", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  let sends = 0;
  let closeCode;
  const hub = createRealtimeHub({
    sessions: harness.kernel.sessions,
    rateLimits: harness.stores.rateLimits,
    allowedOrigins: ["http://localhost:3000"],
  });
  await hub.attach({
    connection: {
      id: "broken-delivery",
      send() {
        sends += 1;
        if (sends > 2) throw new Error("socket closed");
      },
      close(code) { closeCode = code; },
    },
    origin: "http://localhost:3000",
    sessionToken: login.sessionToken,
  });
  await hub.subscribe({ connectionId: "broken-delivery", channel: "guild:1", authorize: async () => true });
  const event = { version: 1, id: "event-1", event: "update", channel: "guild:1", timestamp: new Date().toISOString(), data: {} };
  await hub.publish(event);
  await hub.publish({ ...event, id: "event-2" });
  assert.equal(closeCode, 1011);
  assert.equal(sends, 3);
  hub.close();
});


test("production configuration rejects IPv4, IPv6 and unspecified loopback application URLs", () => {
  for (const baseUrl of [
    "https://127.0.0.1/dashboard",
    "https://[::1]/dashboard",
    "https://0.0.0.0/dashboard",
    "https://[::]/dashboard",
  ]) {
    assert.throws(
      () => createGuildGateTestHarness({
        app: { environment: "production", baseUrl },
        security: { allowedOrigins: ["https://dashboard.example.com"] },
      }),
      (error) => error?.code === "CONFIGURATION_ERROR",
      baseUrl,
    );
  }
});

test("outbox dispatch isolates publisher failures and sanitizes stored errors", async () => {
  const stores = createMemoryStoreBundle();
  const timestamp = new Date().toISOString();
  for (const id of ["ok-1", "bad", "ok-2"]) {
    await stores.outbox.enqueue({
      id,
      event: { version: 1, id, event: "updated", channel: "guild:1", timestamp, data: { id } },
      createdAt: timestamp,
      attempts: 0,
    });
  }
  const published = [];
  const result = await dispatchOutbox({
    store: stores.outbox,
    concurrency: 32,
    publisher: {
      async publish(event) {
        if (event.id === "bad") throw new Error(`publisher\n${"x".repeat(3_000)}`);
        published.push(event.id);
      },
    },
  });
  assert.deepEqual(result, { published: 2, failed: 1, claimed: 3 });
  assert.deepEqual(new Set(published), new Set(["ok-1", "ok-2"]));
  const snapshot = stores.inspect();
  const failed = snapshot.outbox.find((row) => row.id === "bad");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.lastError.includes("\n"), false);
  assert.equal(failed.lastError.length, 2_048);
  assert.equal(snapshot.outbox.filter((row) => row.publishedAt).length, 2);
});

test("outbox worker prevents overlapping runs and waits for an active run before stopping", async () => {
  const stores = createMemoryStoreBundle();
  const timestamp = new Date().toISOString();
  await stores.outbox.enqueue({
    id: "slow",
    event: { version: 1, id: "slow", event: "updated", channel: "guild:1", timestamp, data: {} },
    createdAt: timestamp,
    attempts: 0,
  });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const worker = createOutboxWorker({
    store: stores.outbox,
    publisher: { async publish() { await blocked; } },
    intervalMs: 250,
  });
  const first = worker.runOnce();
  await wait(5);
  assert.deepEqual(await worker.runOnce(), { published: 0, failed: 0, claimed: 0 });
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await wait(10);
  assert.equal(stopped, false);
  release();
  assert.deepEqual(await first, { published: 1, failed: 0, claimed: 1 });
  await stopping;
  assert.equal(stopped, true);
});

test("memory session revocation bus isolates listener failures and supports unsubscription", async () => {
  const bus = new MemorySessionRevocationBus();
  const revoked = [];
  const unbind = bindRevocationBus({ bus, revokeLocal: (sessionIdHash) => revoked.push(sessionIdHash) });
  const unsubscribeFailure = bus.subscribe(() => { throw new Error("listener unavailable"); });
  const message = { sessionIdHash: "session-hash", revokedAt: new Date().toISOString(), source: "test" };
  await bus.publish(message);
  assert.deepEqual(revoked, ["session-hash"]);
  unbind();
  unsubscribeFailure();
  await bus.publish({ ...message, sessionIdHash: "ignored" });
  assert.deepEqual(revoked, ["session-hash"]);
});
