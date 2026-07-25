import test from "node:test";
import assert from "node:assert/strict";
import { createGuildGateTestHarness } from "../dist/testing.js";

function settingsAction(kernel, counter) {
  return kernel.action({
    name: "guild.settings.update",
    parse(value) {
      if (!value || typeof value !== "object") throw new Error("body required");
      const { guildId, revision, locale } = value;
      if (typeof guildId !== "string" || typeof revision !== "number" || typeof locale !== "string") {
        throw new Error("invalid settings body");
      }
      return { guildId, revision, locale };
    },
    resource: (input) => ({ type: "guild", id: input.guildId }),
    rateLimit: { limit: 10, windowMs: 60_000 },
    idempotency: { ttlMs: 60_000 },
    concurrency: { key: (_context, input) => `settings:${input.guildId}` },
    timeoutMs: 1_000,
    async execute(_context, input) {
      counter.count += 1;
      return { guildId: input.guildId, revision: input.revision + 1, locale: input.locale };
    },
    audit: { changes: (result) => result },
    cache: { invalidateTags: (result) => [`guild:${result.guildId}`] },
    realtime: {
      delivery: "outbox",
      events: (result) => [{ event: "guild.settings.updated", channel: `guild:${result.guildId}`, data: result }],
    },
  });
}

test("a protected mutation requires a session and CSRF token", async () => {
  const harness = createGuildGateTestHarness();
  const action = settingsAction(harness.kernel, { count: 0 });

  const anonymous = await harness.kernel.execute(action, harness.request({
    body: { guildId: "1", revision: 1, locale: "en" },
    idempotencyKey: "anon-1",
  }));
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.error.code, "AUTHENTICATION_REQUIRED");

  const login = await harness.login();
  assert.equal(login.setCookie.startsWith("guildgate.sid="), true);
  assert.equal(login.setCookie.includes("__Host-"), false);
  const missingCsrf = await harness.kernel.execute(action, harness.request({
    body: { guildId: "1", revision: 1, locale: "en" },
    sessionToken: login.sessionToken,
    idempotencyKey: "csrf-1",
  }));
  assert.equal(missingCsrf.ok, false);
  assert.equal(missingCsrf.error.code, "CSRF_INVALID");
});

test("idempotency replays the first result and rejects a changed payload", async () => {
  const harness = createGuildGateTestHarness();
  const counter = { count: 0 };
  const action = settingsAction(harness.kernel, counter);
  const login = await harness.login();

  const request = harness.request({
    body: { guildId: "1", revision: 1, locale: "tr" },
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
    idempotencyKey: "save-1",
  });
  const first = await harness.kernel.execute(action, request);
  const replay = await harness.kernel.execute(action, request);

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, first.data);
  assert.equal(counter.count, 1);

  const conflict = await harness.kernel.execute(action, harness.request({
    body: { guildId: "1", revision: 2, locale: "tr" },
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
    idempotencyKey: "save-1",
  }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");

  const state = harness.stores.inspect();
  assert.equal(state.outbox.length, 1);
  assert.equal(state.audit.some((event) => event.result === "success"), true);
});

test("rate limits and owner maintenance policy are enforced", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login();
  const action = harness.kernel.action({
    name: "guild.read.expensive",
    csrf: "disabled",
    rateLimit: { limit: 1, windowMs: 60_000 },
    execute: async () => ({ ok: true }),
  });

  const request = harness.request({ method: "GET", sessionToken: login.sessionToken });
  const first = await harness.kernel.execute(action, request);
  const second = await harness.kernel.execute(action, request);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "RATE_LIMITED");

  await harness.kernel.owner.setMaintenance({ enabled: true, reason: "upgrade", allowOwners: true });
  const normalUser = await harness.kernel.execute(action, harness.request({ method: "GET", sessionToken: login.sessionToken }));
  assert.equal(normalUser.ok, false);
  assert.equal(normalUser.error.code, "MAINTENANCE_MODE");

  const ownerLogin = await harness.login("owner-1");
  const ownerAction = harness.kernel.action({
    name: "owner.health",
    csrf: "disabled",
    execute: async () => "online",
  });
  const ownerResult = await harness.kernel.execute(ownerAction, harness.request({ method: "GET", sessionToken: ownerLogin.sessionToken }));
  assert.equal(ownerResult.ok, true);
  assert.equal(ownerResult.data, "online");
});

test("tag invalidation removes matching cache records", async () => {
  const harness = createGuildGateTestHarness();
  await harness.kernel.cache.set("settings:1", { locale: "en" }, { ttlMs: 30_000, tags: ["guild:1"] });
  assert.deepEqual(await harness.kernel.cache.get("settings:1"), { locale: "en" });
  assert.equal(await harness.kernel.cache.invalidateTags(["guild:1"]), 1);
  assert.equal(await harness.kernel.cache.get("settings:1"), null);
});

test("a post-commit cache failure does not repeat the domain operation", async () => {
  const base = createGuildGateTestHarness();
  const failingCache = {
    ...base.stores.cache,
    async deleteByTags() {
      throw new Error("cache unavailable");
    },
  };
  const harness = createGuildGateTestHarness({
    stores: { ...base.stores, cache: failingCache },
  });
  const login = await harness.login();
  const counter = { count: 0 };
  const action = harness.kernel.action({
    name: "guild.commit.once",
    idempotency: { ttlMs: 60_000 },
    async execute() {
      counter.count += 1;
      return { saved: true };
    },
    cache: { invalidateTags: () => ["guild:1"] },
  });
  const request = harness.request({
    sessionToken: login.sessionToken,
    csrfToken: login.csrfToken,
    idempotencyKey: "commit-once",
  });

  const first = await harness.kernel.execute(action, request);
  const replay = await harness.kernel.execute(action, request);

  assert.equal(first.ok, true);
  assert.deepEqual(first.meta.postCommitIssues, [{ stage: "cache", code: "INTERNAL_ERROR" }]);
  assert.equal(replay.ok, true);
  assert.equal(counter.count, 1);
});

test("built-in errors stay in one locale and can be overridden", async () => {
  const harness = createGuildGateTestHarness({
    locale: {
      default: "tr",
      messages: {
        tr: { AUTHENTICATION_REQUIRED: "Bu alan için yeniden giriş yapın." },
      },
    },
  });
  const action = harness.kernel.action({
    name: "private.read",
    csrf: "disabled",
    execute: async () => "secret",
  });
  const result = await harness.kernel.execute(action, harness.request({ method: "GET", locale: "tr" }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(result.error.message, "Bu alan için yeniden giriş yapın.");
});
