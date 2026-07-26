import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordJsGuildAdapter } from "../dist/discordjs.js";
import { DiscordPermissions } from "../dist/discord.js";
import { createHonoHandler } from "../dist/hono.js";
import { createOpenTelemetryHooks } from "../dist/telemetry.js";
import { createGuildGateTestHarness } from "../dist/testing.js";


test("discord.js adapter checks user and bot permissions without importing discord.js", async () => {
  const guild = {
    id: "1",
    ownerId: "owner",
    members: {
      me: { id: "bot", permissions: { bitfield: DiscordPermissions.MANAGE_GUILD } },
      async fetch(userId) {
        return { id: userId, permissions: { bitfield: DiscordPermissions.MANAGE_GUILD } };
      },
    },
  };
  const adapter = createDiscordJsGuildAdapter({
    guilds: { cache: { get: () => guild, size: 1 }, async fetch() { return guild; } },
    user: { id: "bot" },
    isReady: () => true,
    ws: { ping: 15 },
  });
  const { authorize, getMember, status } = adapter;
  const decision = await authorize({ guildId: "1", userId: "user", userPermissions: ["MANAGE_GUILD"], botPermissions: ["MANAGE_GUILD"] });
  assert.equal(decision.allowed, true);
  assert.equal((await getMember("1", "user")).id, "user");
  assert.equal(status().websocketPingMs, 15);
});

test("Hono adapter returns a web-standard JSON response", async () => {
  const harness = createGuildGateTestHarness();
  const action = harness.kernel.action({ name: "public.hono", authentication: "none", csrf: "disabled", execute: async () => ({ ok: true }) });
  const handler = createHonoHandler(harness.kernel, action);
  const headers = new Headers();
  const response = await handler({
    req: {
      method: "GET",
      url: "http://localhost:3000/test",
      header(name) { return name === "origin" ? "http://localhost:3000" : undefined; },
      raw: new Request("http://localhost:3000/test"),
    },
    header(name, value) { headers.set(name, value); },
    json(payload, status = 200) { return Response.json(payload, { status, headers }); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { ok: true });
  assert.ok(response.headers.get("x-request-id"));
});

test("OpenTelemetry bridge records spans and metrics through a user supplied API", async () => {
  const calls = [];
  const hooks = createOpenTelemetryHooks({
    trace: { getTracer: () => ({ startSpan: (name) => ({ setAttribute: (key, value) => calls.push(["attribute", key, value]), recordException: () => calls.push(["exception"]), end: () => calls.push(["end", name]) }) }) },
    metrics: { getMeter: () => ({ createCounter: (name) => ({ add: (value) => calls.push(["counter", name, value]) }), createHistogram: (name) => ({ record: (value) => calls.push(["histogram", name, value]) }) }) },
  });
  const span = hooks.startAction({ action: "test", requestId: "1", method: "GET", path: "/" });
  span?.setAttribute("custom", true);
  span?.end();
  await hooks.actionFinished({ action: "test", requestId: "1", ok: true, durationMs: 4, status: 200 });
  assert.equal(calls.some((call) => call[0] === "counter"), true);
  assert.equal(calls.some((call) => call[0] === "histogram"), true);
});
