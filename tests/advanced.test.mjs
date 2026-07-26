import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryAnalyticsStore,
  StatusMonitor,
  bucketMetrics,
  renderBarChartSvg,
  renderDonutChartSvg,
  renderLineChartSvg,
} from "../dist/analytics.js";
import { DistributedLockManager } from "../dist/locks.js";
import { createOperatorActions, RatePolicyRegistry } from "../dist/operator.js";
import { createGuildGateTestHarness } from "../dist/testing.js";

function validRequest(harness, login, body, key = "advanced") {
  return harness.request({ body, sessionToken: login.sessionToken, csrfToken: login.csrfToken, idempotencyKey: key });
}

test("optimistic concurrency rejects a stale revision", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  let revision = 3;
  const action = harness.kernel.action({
    name: "settings.optimistic",
    parse: (value) => value,
    optimistic: {
      expected: (input) => input.revision,
      current: () => revision,
      resource: (input) => `guild:${input.guildId}`,
    },
    async execute(_context, input) {
      revision += 1;
      return { ...input, revision };
    },
  });
  const stale = await harness.kernel.execute(action, validRequest(harness, login, { guildId: "1", revision: 2 }));
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "REVISION_CONFLICT");
  const current = await harness.kernel.execute(action, validRequest(harness, login, { guildId: "1", revision: 3 }, "advanced-2"));
  assert.equal(current.ok, true);
  assert.equal(current.data.revision, 4);
});

test("transaction hooks, retry and fencing token are exposed to actions", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  const calls = [];
  let attempts = 0;
  const action = harness.kernel.action({
    name: "settings.transaction",
    timeoutMs: 2_000,
    idempotency: { ttlMs: 60_000 },
    concurrency: { key: () => "guild:1", ttlMs: 1_000, renewEveryMs: 200 },
    retry: { attempts: 2, baseDelayMs: 1, maximumDelayMs: 2, shouldRetry: () => true },
    transaction: {
      isolation: "serializable",
      hooks: {
        before: () => calls.push("before"),
        beforeCommit: () => calls.push("beforeCommit"),
        afterCommit: () => calls.push("afterCommit"),
        afterRollback: () => calls.push("afterRollback"),
      },
    },
    async execute(context) {
      attempts += 1;
      assert.equal(typeof context.fencingToken, "number");
      assert.equal(context.transaction?.backend, "memory");
      if (attempts === 1) throw new TypeError("temporary");
      return { saved: true, attempt: context.attempt };
    },
  });
  const result = await harness.kernel.execute(action, validRequest(harness, login, {}, "transaction"));
  assert.equal(result.ok, true);
  assert.equal(result.data.attempt, 2);
  assert.deepEqual(calls, ["before", "afterRollback", "before", "beforeCommit", "afterCommit"]);
});

test("memory locks issue increasing fencing tokens", async () => {
  const harness = createGuildGateTestHarness();
  const manager = new DistributedLockManager(harness.stores.locks);
  const first = await manager.acquire({ key: "resource", ttlMs: 1_000 });
  const firstToken = first.lease.fencingToken;
  await first.release();
  const second = await manager.acquire({ key: "resource", ttlMs: 1_000 });
  assert.equal(second.lease.fencingToken > firstToken, true);
  await second.release();
});

test("analytics store, buckets, charts and status monitor produce usable output", async () => {
  const store = new MemoryAnalyticsStore();
  const base = Date.now();
  await store.writeMany([1, 2, 3, 9].map((value, index) => ({
    name: "bot.ping",
    value,
    kind: "histogram",
    timestamp: new Date(base + index * 1_000).toISOString(),
  })));
  const points = await store.query({ names: ["bot.ping"] });
  const buckets = bucketMetrics(points, 2_000);
  assert.equal(buckets.length >= 2, true);
  assert.equal(buckets[0].count >= 1, true);
  const chart = { title: "Ping", description: "Gateway latency", labels: ["A", "B"], series: [{ name: "Ping", values: [10, 20] }], theme: { palette: ["#123456"], backgroundColor: "#ffffff" } };
  assert.match(renderLineChartSvg(chart), /<svg/);
  assert.match(renderLineChartSvg(chart), /#123456/);
  assert.match(renderLineChartSvg(chart), /<desc>Gateway latency<\/desc>/);
  assert.match(renderBarChartSvg(chart), /<rect/);
  assert.match(renderDonutChartSvg({ title: "State", labels: ["up", "down"], values: [9, 1] }), /<circle/);

  const monitor = new StatusMonitor({
    store,
    probes: [{ id: "api", label: "API", async check() { return { status: "operational", latencyMs: 2 }; } }],
    bot: { collect: () => ({ ready: true, guildCount: 4, websocketPingMs: 12 }) },
    collectors: [{ id: "jobs", collect: (checkedAt) => [{ name: "jobs.pending", value: 7, kind: "gauge", timestamp: checkedAt }] }],
  });
  const snapshot = await monitor.sample();
  assert.equal(snapshot.status, "operational");
  assert.equal((await store.query({ names: ["bot.guilds"] })).at(-1)?.value, 4);
  assert.equal((await store.query({ names: ["jobs.pending"] })).at(-1)?.value, 7);
  await monitor.stop();
});

test("operator actions manage sessions, policies and owner rate resets", async () => {
  const harness = createGuildGateTestHarness();
  const analytics = new MemoryAnalyticsStore();
  const ratePolicies = new RatePolicyRegistry()
    .register({ name: "owner-safe", limit: 5, windowMs: 60_000, ownerResettable: true })
    .register({ name: "fixed", limit: 1, windowMs: 60_000, ownerResettable: false });
  const actions = createOperatorActions({ kernel: harness.kernel, analytics, ratePolicies });
  const user = await harness.login("user-1");
  await harness.login("user-1");
  const sessions = await harness.kernel.execute(actions.listSessions, harness.request({ method: "GET", sessionToken: user.sessionToken }));
  assert.equal(sessions.ok, true);
  assert.equal(sessions.data.items.length, 2);
  const revoked = await harness.kernel.execute(actions.revokeOtherSessions, harness.request({ sessionToken: user.sessionToken, csrfToken: user.csrfToken }));
  assert.equal(revoked.ok, true);
  assert.equal(revoked.data.revoked, 1);
  const denied = await harness.kernel.execute(actions.inspectPolicies, harness.request({ method: "GET", sessionToken: user.sessionToken }));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "OWNER_REQUIRED");
  const owner = await harness.login("owner-1");
  await harness.kernel.owner.block({ subjectType: "guild", subjectId: "blocked-guild", reason: "test" });
  const allowed = await harness.kernel.execute(actions.inspectPolicies, harness.request({ method: "GET", sessionToken: owner.sessionToken }));
  assert.equal(allowed.ok, true);
  assert.equal(allowed.data.blocks.some((block) => block.subjectId === "blocked-guild"), true);
  const reset = await harness.kernel.execute(actions.resetRateLimit, harness.request({ sessionToken: owner.sessionToken, csrfToken: owner.csrfToken, body: { key: "guildgate:rate:test", policyName: "owner-safe" } }));
  assert.equal(reset.ok, true);
  const resetDenied = await harness.kernel.execute(actions.resetRateLimit, harness.request({ sessionToken: owner.sessionToken, csrfToken: owner.csrfToken, body: { key: "guildgate:rate:test", policyName: "fixed" } }));
  assert.equal(resetDenied.ok, false);
  assert.equal(resetDenied.error.code, "RATE_POLICY_RESET_DENIED");
});
