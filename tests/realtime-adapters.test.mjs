import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createGuildGateTestHarness } from "../dist/testing.js";
import {
  MemoryRealtimeEventLog,
  attachWebSocket,
  createRealtimeHub,
  createSequencedPublisher,
  createServerSentEventStream,
} from "../dist/realtime.js";

class FakeSocket extends EventEmitter {
  sent = [];
  closed = [];
  bufferedAmount = 0;
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code, reason) { this.closed.push({ code, reason }); this.emit("close"); }
  ping() { queueMicrotask(() => this.emit("pong")); }
}

test("sequenced publisher stores replay cursors", async () => {
  const log = new MemoryRealtimeEventLog();
  const published = [];
  const publisher = createSequencedPublisher({ log, publish: async (event) => published.push(event) });
  await publisher.publish({ version: 1, id: "1", event: "update", channel: "guild:1", timestamp: new Date().toISOString(), data: { value: 1 } });
  await publisher.publish({ version: 1, id: "2", event: "update", channel: "guild:1", timestamp: new Date().toISOString(), data: { value: 2 } });
  assert.equal(published[1].sequence, 2);
  assert.deepEqual((await log.replay("guild:1", 1, 10)).map((event) => event.data.value), [2]);
});

test("WebSocket adapter authorizes subscriptions and replays missed events", async () => {
  const harness = createGuildGateTestHarness();
  const login = await harness.login("user-1");
  const hub = createRealtimeHub({ sessions: harness.kernel.sessions, rateLimits: harness.stores.rateLimits, allowedOrigins: ["http://localhost:3000"], heartbeatIntervalMs: 60_000 });
  const log = new MemoryRealtimeEventLog();
  await log.append({ version: 1, id: "old", event: "update", channel: "guild:1", timestamp: new Date().toISOString(), data: { revision: 1 } });
  const socket = new FakeSocket();
  const attached = await attachWebSocket({
    socket,
    hub,
    origin: "http://localhost:3000",
    sessionToken: login.sessionToken,
    eventLog: log,
    authorize: async ({ userId, channel }) => userId === "user-1" && channel === "guild:1",
    heartbeatMs: 60_000,
  });
  socket.emit("message", JSON.stringify({ type: "subscribe", channel: "guild:1", afterSequence: 0 }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(socket.sent.some((message) => message.type === "subscribed"), true);
  assert.equal(socket.sent.some((message) => message.type === "replay"), true);
  attached.close();
  hub.close();
});

test("SSE adapter formats events and closes on backpressure overflow", async () => {
  const chunks = [];
  let ended = false;
  const stream = createServerSentEventStream({
    writer: { write(chunk) { chunks.push(chunk); return true; }, end() { ended = true; } },
    maximumBufferedEvents: 2,
  });
  assert.equal(await stream.send({ event: "update", id: 4, data: { ok: true } }), true);
  assert.match(chunks.join(""), /id: 4/);
  assert.match(chunks.join(""), /event: update/);
  stream.close();
  assert.equal(ended, true);
});
