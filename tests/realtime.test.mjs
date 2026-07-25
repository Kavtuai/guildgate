import test from "node:test";
import assert from "node:assert/strict";
import { createGuildGateTestHarness } from "../dist/testing.js";
import { createRealtimeHub } from "../dist/realtime.js";

test("realtime subscriptions are authorized and session revocation closes sockets", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login("user-9");
  const sent = [];
  const closed = [];
  const connection = {
    id: "socket-1",
    bufferedAmount: 0,
    send(payload) { sent.push(JSON.parse(payload)); },
    close(code, reason) { closed.push({ code, reason }); },
  };
  const hub = createRealtimeHub({
    sessions: harness.kernel.sessions,
    rateLimits: harness.stores.rateLimits,
    allowedOrigins: ["http://localhost:3000"],
    heartbeatIntervalMs: 60_000,
  });

  await hub.attach({ connection, origin: "http://localhost:3000", sessionToken: login.sessionToken });
  await hub.subscribe({
    connectionId: connection.id,
    channel: "guild:9",
    authorize: async (session, channel) => session.userId === "user-9" && channel === "guild:9",
  });
  await hub.publish({
    version: 1,
    id: "event-1",
    event: "settings.updated",
    channel: "guild:9",
    timestamp: new Date().toISOString(),
    data: { revision: 2 },
  });
  assert.equal(sent.some((message) => message.event === "settings.updated"), true);

  hub.revokeSession(login.session.idHash);
  assert.deepEqual(closed, [{ code: 1008, reason: "Session revoked" }]);
  hub.close();
});

test("realtime heartbeat closes a session revoked outside the hub", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login("user-10");
  const closed = [];
  const connection = {
    id: "socket-2",
    bufferedAmount: 0,
    send() {},
    close(code, reason) { closed.push({ code, reason }); },
  };
  const hub = createRealtimeHub({
    sessions: harness.kernel.sessions,
    rateLimits: harness.stores.rateLimits,
    allowedOrigins: ["http://localhost:3000"],
    heartbeatIntervalMs: 10,
    sessionValidationIntervalMs: 1,
    idleTimeoutMs: 60_000,
  });

  await hub.attach({ connection, origin: "http://localhost:3000", sessionToken: login.sessionToken });
  await harness.kernel.revokeSession(login.sessionToken);
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.deepEqual(closed, [{ code: 1008, reason: "Session expired or revoked" }]);
  hub.close();
});
