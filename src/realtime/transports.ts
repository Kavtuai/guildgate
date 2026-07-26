import { randomUUID } from "node:crypto";
import type { RealtimeHub } from "./hub.js";
import type { RealtimeEvent } from "../types.js";
import type { RealtimeEventLog } from "./sequence.js";

export interface WebSocketLike {
  send(data: string): void | Promise<void>;
  close(code?: number, reason?: string): void;
  bufferedAmount?: number;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close" | "error" | "pong", listener: (...args: unknown[]) => void): unknown;
  ping?(): void;
}

export interface WebSocketAttachInput {
  socket: WebSocketLike;
  hub: RealtimeHub;
  origin?: string;
  sessionToken?: string;
  authorize: (input: { userId: string; sessionIdHash: string; channel: string }) => Promise<boolean>;
  eventLog?: RealtimeEventLog;
  heartbeatMs?: number;
  maximumReplayEvents?: number;
}

export async function attachWebSocket(input: WebSocketAttachInput): Promise<{ connectionId: string; close(): void }> {
  const connectionId = randomUUID();
  let alive = true;
  const heartbeat = input.socket.ping
    ? setInterval(() => {
        if (!alive) {
          input.socket.close(1001, "Heartbeat timeout");
          input.hub.detach(connectionId);
          return;
        }
        alive = false;
        input.socket.ping?.();
      }, Math.max(1_000, input.heartbeatMs ?? 25_000))
    : undefined;
  (heartbeat as unknown as { unref?: () => void } | undefined)?.unref?.();

  await input.hub.attach({
    connection: {
      id: connectionId,
      send: (payload) => input.socket.send(payload),
      close: (code, reason) => input.socket.close(code, reason),
      get bufferedAmount() { return input.socket.bufferedAmount; },
    },
    origin: input.origin,
    sessionToken: input.sessionToken,
  });

  input.socket.on("pong", () => { alive = true; input.hub.touch(connectionId); });
  input.socket.on("message", (raw) => {
    void handleMessage(typeof raw === "string" ? raw : String(raw)).catch(() => {
      input.socket.close(1008, "Invalid realtime message");
    });
  });
  const close = () => {
    if (heartbeat) clearInterval(heartbeat);
    input.hub.detach(connectionId);
  };
  input.socket.on("close", close);
  input.socket.on("error", close);

  return { connectionId, close };

  async function handleMessage(payload: string): Promise<void> {
    const message = await input.hub.acceptMessage(connectionId, payload) as {
      type?: string;
      channel?: string;
      afterSequence?: number;
    } | null;
    if (!message) return;
    if (message.type === "subscribe" && message.channel) {
      const subscribed = await input.hub.subscribe({
        connectionId,
        channel: message.channel,
        authorize: (session, channel) => input.authorize({ userId: session.userId, sessionIdHash: session.idHash, channel }),
      });
      if (subscribed && input.eventLog && Number.isFinite(message.afterSequence) && (message.afterSequence ?? 0) >= 0) {
        const events = await input.eventLog.replay(message.channel, message.afterSequence ?? 0, Math.max(1, Math.min(5_000, input.maximumReplayEvents ?? 500)));
        for (const event of events) await input.socket.send(JSON.stringify({ type: "replay", event }));
      }
    } else if (message.type === "unsubscribe" && message.channel) {
      input.hub.unsubscribe(connectionId, message.channel);
    }
  }
}

export interface ServerSentEventWriter {
  write(chunk: string): boolean | void;
  end(): void;
  on?(event: "close" | "drain", listener: () => void): unknown;
}

export interface ServerSentEventStream {
  send(event: RealtimeEvent | { event: string; data: unknown; id?: string | number }): Promise<boolean>;
  heartbeat(): Promise<boolean>;
  close(): void;
  readonly bufferedEvents: number;
}

export function createServerSentEventStream(input: {
  writer: ServerSentEventWriter;
  maximumBufferedEvents?: number;
  retryMs?: number;
}): ServerSentEventStream {
  const queue: string[] = [];
  let closed = false;
  let draining = false;
  input.writer.write(`retry: ${Math.max(1_000, input.retryMs ?? 5_000)}\n\n`);
  input.writer.on?.("drain", () => { void flush(); });
  input.writer.on?.("close", () => { closed = true; queue.length = 0; });

  return {
    get bufferedEvents() { return queue.length; },
    async send(event) {
      const id = "id" in event && event.id !== undefined ? String(event.id) : undefined;
      const eventName = event.event;
      const data = "data" in event ? event.data : event;
      const payload = `${id ? `id: ${sanitize(id)}\n` : ""}event: ${sanitize(eventName)}\ndata: ${JSON.stringify(data)}\n\n`;
      return enqueue(payload);
    },
    async heartbeat() {
      return enqueue(`: heartbeat ${Date.now()}\n\n`);
    },
    close() {
      closed = true;
      queue.length = 0;
      input.writer.end();
    },
  };

  async function enqueue(payload: string): Promise<boolean> {
    if (closed) return false;
    if (queue.length >= (input.maximumBufferedEvents ?? 128)) {
      closed = true;
      input.writer.end();
      return false;
    }
    queue.push(payload);
    await flush();
    return !closed;
  }

  async function flush(): Promise<void> {
    if (draining || closed) return;
    draining = true;
    try {
      while (queue.length && !closed) {
        const chunk = queue[0];
        if (!chunk) break;
        const accepted = input.writer.write(chunk);
        if (accepted === false) return;
        queue.shift();
      }
    } finally {
      draining = false;
    }
  }
}

function sanitize(value: string): string {
  return value.replace(/[\r\n]/g, " ");
}

export interface SocketIoLike {
  id: string;
  handshake?: { headers?: Record<string, string | string[] | undefined>; auth?: Record<string, unknown> };
  data?: Record<string, unknown>;
  emit(event: string, payload?: unknown): unknown;
  disconnect(close?: boolean): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  onAny?(listener: (event: string, ...args: unknown[]) => void): unknown;
  volatile?: { emit(event: string, payload?: unknown): unknown };
  conn?: { transport?: { writable?: boolean } };
}

export async function attachSocketIo(input: {
  socket: SocketIoLike;
  hub: RealtimeHub;
  sessionToken?: string;
  origin?: string;
  authorize: (input: { userId: string; sessionIdHash: string; channel: string }) => Promise<boolean>;
  eventLog?: RealtimeEventLog;
  maximumReplayEvents?: number;
}): Promise<{ connectionId: string; close(): void }> {
  const connectionId = input.socket.id || randomUUID();
  let closed = false;
  await input.hub.attach({
    connection: {
      id: connectionId,
      send(payload) {
        input.socket.emit("guildgate:event", JSON.parse(payload) as unknown);
      },
      close(_code, reason) {
        if (closed) return;
        closed = true;
        input.socket.emit("guildgate:close", { reason });
        input.socket.disconnect(true);
      },
      get bufferedAmount() {
        return input.socket.conn?.transport?.writable === false ? Number.POSITIVE_INFINITY : 0;
      },
    },
    origin: input.origin ?? socketHeader(input.socket, "origin"),
    sessionToken: input.sessionToken ?? stringValue(input.socket.handshake?.auth?.sessionToken),
  });


  input.socket.on("guildgate:subscribe", (...args) => {
    void processClientMessage("subscribe", args);
  });
  input.socket.on("guildgate:unsubscribe", (...args) => {
    void processClientMessage("unsubscribe", args);
  });
  input.socket.on("guildgate:heartbeat", (...args) => {
    void processClientMessage("heartbeat", args);
  });
  input.socket.on("disconnect", () => {
    closed = true;
    input.hub.detach(connectionId);
  });

  return {
    connectionId,
    close() {
      if (closed) return;
      closed = true;
      input.hub.detach(connectionId);
      input.socket.disconnect(true);
    },
  };

  async function processClientMessage(type: "subscribe" | "unsubscribe" | "heartbeat", args: unknown[]): Promise<void> {
    const acknowledgement = typeof args.at(-1) === "function" ? args.at(-1) as (value: unknown) => void : undefined;
    const message = objectValue(args[0]);
    try {
      const accepted = await input.hub.acceptMessage(connectionId, JSON.stringify({ ...message, type })) as {
        type?: string;
        channel?: string;
        afterSequence?: number;
      } | null;
      if (!accepted) return;
      if (type === "heartbeat") {
        input.socket.emit("guildgate:heartbeat", { timestamp: Date.now() });
        acknowledgement?.({ ok: true });
        return;
      }
      const channel = stringValue(accepted.channel);
      if (!channel) {
        acknowledgement?.({ ok: false, code: "INVALID_CHANNEL" });
        return;
      }
      if (type === "unsubscribe") {
        input.hub.unsubscribe(connectionId, channel);
        acknowledgement?.({ ok: true, channel });
        return;
      }
      const subscribed = await input.hub.subscribe({
        connectionId,
        channel,
        authorize: (session, target) => input.authorize({ userId: session.userId, sessionIdHash: session.idHash, channel: target }),
      });
      if (subscribed && input.eventLog) {
        const afterSequence = numberValue(accepted.afterSequence);
        if (afterSequence !== undefined && afterSequence >= 0) {
          const events = await input.eventLog.replay(channel, afterSequence, Math.max(1, Math.min(5_000, input.maximumReplayEvents ?? 500)));
          for (const event of events) input.socket.emit("guildgate:replay", event);
        }
      }
      acknowledgement?.({ ok: subscribed, channel });
    } catch {
      acknowledgement?.({ ok: false, code: "INVALID_REALTIME_MESSAGE" });
      if (!closed) {
        closed = true;
        input.socket.emit("guildgate:close", { reason: "Invalid realtime message" });
        input.socket.disconnect(true);
        input.hub.detach(connectionId);
      }
    }
  }
}

function socketHeader(socket: SocketIoLike, name: string): string | undefined {
  const value = socket.handshake?.headers?.[name] ?? socket.handshake?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
