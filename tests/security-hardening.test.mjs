import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createGuildGateTestHarness,
} from "../dist/testing.js";
import {
  createTokenCipher,
  GuildGateError,
  redactValue,
  renderLineChartSvg,
  stableStringify,
} from "../dist/index.js";
import { createRedisEphemeralStores } from "../dist/redis.js";
import {
  MemoryRealtimeEventLog,
  attachWebSocket,
  createRealtimeHub,
} from "../dist/realtime.js";
import { createPostgresAdapter } from "../dist/postgres.js";

class FakeSocket extends EventEmitter {
  sent = [];
  closed = [];
  bufferedAmount = 0;
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code, reason) { this.closed.push({ code, reason }); this.emit("close"); }
}

test("hidden server errors do not expose internal details", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  const action = harness.kernel.action({
    name: "security.hidden-error",
    async execute() {
      throw new GuildGateError({
        code: "UPSTREAM_FAILED",
        status: 502,
        expose: false,
        details: { access_token: "secret", responseBody: "private" },
      });
    },
  });
  const result = await harness.kernel.execute(action, harness.request({
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error.details, undefined);
  assert.notEqual(result.error.message, "private");
});

test("audit redaction handles common secret key styles and circular data", () => {
  const input = { access_token: "a", clientSecret: "b", nested: { "bot-token": "c" } };
  input.circular = input;
  const redacted = redactValue(input, new Set(["accessToken", "clientSecret", "botToken"]));
  assert.equal(redacted.access_token, "[REDACTED]");
  assert.equal(redacted.clientSecret, "[REDACTED]");
  assert.equal(redacted.nested["bot-token"], "[REDACTED]");
  assert.equal(redacted.circular, "[CIRCULAR]");
});

test("stable serialization rejects circular request data without overflowing", () => {
  const input = {};
  input.self = input;
  assert.throws(() => stableStringify(input), /circular reference/);
});

test("SVG chart themes cannot inject markup or unbounded dimensions", () => {
  const svg = renderLineChartSvg({
    labels: ["one"],
    series: [{ name: "metric", values: [1] }],
    width: 100_000,
    height: -20,
    theme: {
      palette: ['#fff\"/><script>alert(1)</script>'],
      titleColor: "red}</style><script>alert(2)</script>",
      backgroundColor: "url(javascript:alert(3))",
    },
  });
  assert.doesNotMatch(svg, /<script|javascript:/i);
  assert.match(svg, /width="4096"/);
  assert.match(svg, /height="120"/);
});

test("denied realtime subscriptions cannot replay stored events", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login("user-1");
  const hub = createRealtimeHub({
    sessions: harness.kernel.sessions,
    rateLimits: harness.stores.rateLimits,
    allowedOrigins: ["http://localhost:3000"],
    heartbeatIntervalMs: 60_000,
  });
  const log = new MemoryRealtimeEventLog();
  await log.append({ version: 1, id: "secret", event: "private", channel: "guild:private", timestamp: new Date().toISOString(), data: { secret: true } });
  const socket = new FakeSocket();
  const attached = await attachWebSocket({
    socket,
    hub,
    origin: "http://localhost:3000",
    sessionToken: login.sessionToken,
    eventLog: log,
    authorize: async () => false,
  });
  socket.emit("message", JSON.stringify({ type: "subscribe", channel: "guild:private", afterSequence: 0 }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(socket.sent.some((message) => message.type === "replay"), false);
  assert.equal(socket.sent.some((message) => message.code === "SUBSCRIPTION_DENIED"), true);
  attached.close();
  hub.close();
});

test("malformed realtime JSON closes the connection with an invalid-data code", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login("user-1");
  const hub = createRealtimeHub({ sessions: harness.kernel.sessions, rateLimits: harness.stores.rateLimits, allowedOrigins: ["http://localhost:3000"], heartbeatIntervalMs: 60_000 });
  const socket = new FakeSocket();
  const attached = await attachWebSocket({ socket, hub, origin: "http://localhost:3000", sessionToken: login.sessionToken, authorize: async () => true });
  socket.emit("message", "{");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(socket.closed.some((item) => item.code === 1007), true);
  attached.close();
  hub.close();
});

test("action configuration rejects unsafe retry and lock settings", () => {
  const harness = createGuildGateTestHarness();
  assert.throws(() => harness.kernel.action({ name: "bad name", execute: async () => null }), /Action names/);
  assert.throws(() => harness.kernel.action({ name: "bad.lock", concurrency: { key: () => "x", ttlMs: 1000, renewEveryMs: 1000 }, execute: async () => null }), /renewEveryMs/);
  assert.throws(() => harness.kernel.action({ name: "bad.retry", retry: { attempts: 0, baseDelayMs: 1, maximumDelayMs: 1 }, execute: async () => null }), /retry policy/);
});

test("default retries do not repeat arbitrary TypeError failures", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  let calls = 0;
  const action = harness.kernel.action({
    name: "security.no-typeerror-retry",
    retry: { attempts: 3, baseDelayMs: 1, maximumDelayMs: 2 },
    async execute() { calls += 1; throw new TypeError("application bug"); },
  });
  const result = await harness.kernel.execute(action, harness.request({ sessionToken: login.sessionToken, csrfToken: login.csrfToken }));
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});

test("token cipher rejects malformed payload sizes and authenticates ciphertext", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const cipher = createTokenCipher({ keys: { current: key }, activeKeyId: "current" });
  const encrypted = cipher.encrypt("token");
  assert.equal(cipher.decrypt(encrypted), "token");
  const tamperedParts = encrypted.split(".");
  const tamperedTag = Buffer.from(tamperedParts[3], "base64url");
  tamperedTag[0] ^= 1;
  tamperedParts[3] = tamperedTag.toString("base64url");
  assert.throws(() => cipher.decrypt(tamperedParts.join(".")));
  assert.throws(() => cipher.decrypt("x".repeat(140_000)), /too large/);
});

test("Redis lock adapter exposes renewable leases and increasing fencing tokens", async () => {
  const values = new Map();
  const fences = new Map();
  const redis = {
    async get(key) { return values.get(key)?.value ?? null; },
    async set(key, value) { values.set(key, { value }); return true; },
    async del(...keys) { let count = 0; for (const key of keys) count += values.delete(key) ? 1 : 0; return count; },
    async sAdd() { return 1; }, async sRem() { return 1; }, async sMembers() { return []; }, async pTtl() { return 1000; },
    async eval(script, keys, args) {
      if (script.includes("local fence = redis.call('INCR'")) {
        if (values.has(keys[0])) return [0, 0];
        values.set(keys[0], { value: args[0] });
        const next = (fences.get(keys[1]) ?? 0) + 1;
        fences.set(keys[1], next);
        return [1, next];
      }
      if (script.includes("PEXPIRE")) return values.get(keys[0])?.value === args[0] ? 1 : 0;
      if (script.includes("redis.call('DEL'")) {
        if (values.get(keys[0])?.value === args[0]) { values.delete(keys[0]); return 1; }
        return 0;
      }
      return null;
    },
  };
  const stores = createRedisEphemeralStores(redis, { prefix: "ggtest" });
  const first = await stores.locks.acquireLease("resource", "one", 1000, 0);
  assert.equal(first.fencingToken, 1);
  assert.equal(await stores.locks.renew("resource", "one", 1000), true);
  await stores.locks.release("resource", "one");
  const second = await stores.locks.acquireLease("resource", "two", 1000, 0);
  assert.equal(second.fencingToken, 2);
});

test("PostgreSQL idempotency acquisition uses insert-on-conflict without overwriting an active record", async () => {
  const statements = [];
  const client = {
    async query(text) {
      statements.push(text);
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      if (text.includes("ON CONFLICT (key) DO NOTHING RETURNING key")) return { rows: [{ key: "k" }], rowCount: 1 };
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async query(text) { statements.push(text); return { rows: [] }; }, async connect() { return client; } };
  const adapter = createPostgresAdapter({ pool, prefix: "gg" });
  const result = await adapter.stores.idempotency.begin({ key: "k", requestHash: "h", reservationId: "reservation-one", state: "inflight", createdAtMs: 1, expiresAtMs: Date.now() + 1000 });
  assert.equal(result.status, "started");
  assert.equal(statements.some((text) => text.includes("DO UPDATE SET expires_at=EXCLUDED.expires_at")), false);
});
