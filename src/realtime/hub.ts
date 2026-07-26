import { randomUUID } from "node:crypto";
import { assertAllowedOrigin, normalizeOrigin } from "../security.js";
import type { SessionManager } from "../session.js";
import type { RateLimitStore } from "../stores.js";
import type { RealtimeEvent, SessionRecord } from "../types.js";

export interface RealtimeConnection {
  id: string;
  send(payload: string): void | Promise<void>;
  close(code: number, reason: string): void;
  bufferedAmount?: number;
}

interface AttachedConnection {
  connection: RealtimeConnection;
  session: SessionRecord;
  sessionToken: string;
  subscriptions: Set<string>;
  lastSeenAtMs: number;
  createdAtMs: number;
  lastSessionValidatedAtMs: number;
}

export interface RealtimeHub {
  attach(input: { connection: RealtimeConnection; origin: string | undefined; sessionToken: string | undefined }): Promise<void>;
  detach(connectionId: string): void;
  subscribe(input: { connectionId: string; channel: string; authorize: (session: SessionRecord, channel: string) => Promise<boolean> }): Promise<boolean>;
  unsubscribe(connectionId: string, channel: string): void;
  touch(connectionId: string): void;
  acceptMessage(connectionId: string, payload: string): Promise<unknown>;
  publish(event: RealtimeEvent): Promise<void>;
  revokeSession(sessionIdHash: string): void;
  close(): void;
}

export function createRealtimeHub(input: {
  sessions: SessionManager;
  rateLimits: RateLimitStore;
  allowedOrigins: string[];
  heartbeatIntervalMs?: number;
  idleTimeoutMs?: number;
  maximumLifetimeMs?: number;
  maximumMessageBytes?: number;
  maximumSubscriptions?: number;
  maximumChannelLength?: number;
  maximumBufferedBytes?: number;
  messagesPerWindow?: number;
  messageWindowMs?: number;
  sessionValidationIntervalMs?: number;
}): RealtimeHub {
  const origins = new Set(input.allowedOrigins.map(normalizeOrigin));
  const connections = new Map<string, AttachedConnection>();
  const bySession = new Map<string, Set<string>>();
  let checkingConnections = false;
  const heartbeat = setInterval(() => { void checkConnections(); }, input.heartbeatIntervalMs ?? 25_000);
  (heartbeat as unknown as { unref?: () => void }).unref?.();

  return {
    async attach({ connection, origin, sessionToken }) {
      removeConnection(connection.id);
      assertAllowedOrigin(origin, origins);
      const session = await input.sessions.validate(sessionToken);
      if (!session || !sessionToken) {
        connection.close(1008, "Authentication required");
        return;
      }
      const record: AttachedConnection = {
        connection,
        session,
        sessionToken,
        subscriptions: new Set(),
        lastSeenAtMs: Date.now(),
        createdAtMs: Date.now(),
        lastSessionValidatedAtMs: Date.now(),
      };
      connections.set(connection.id, record);
      const ids = bySession.get(record.session.idHash) ?? new Set<string>();
      ids.add(connection.id);
      bySession.set(record.session.idHash, ids);
      await send(record, { type: "ready", connectionId: connection.id });
    },

    detach(connectionId) {
      removeConnection(connectionId);
    },

    async subscribe({ connectionId, channel, authorize }) {
      const record = requireConnection(connectionId);
      if (!channel || channel.length > (input.maximumChannelLength ?? 256) || /[\u0000-\u001f\u007f]/.test(channel)) {
        await send(record, { type: "error", code: "INVALID_CHANNEL" });
        return false;
      }
      if (record.subscriptions.has(channel)) {
        await send(record, { type: "subscribed", channel });
        return true;
      }
      if (record.subscriptions.size >= (input.maximumSubscriptions ?? 20)) {
        record.connection.close(1008, "Subscription limit exceeded");
        removeConnection(connectionId);
        return false;
      }
      if (!await authorize(record.session, channel)) {
        await send(record, { type: "error", code: "SUBSCRIPTION_DENIED", channel });
        return false;
      }
      // Authorization may be asynchronous. Re-check connection state and capacity so
      // concurrent subscription requests cannot bypass the configured limit.
      if (connections.get(connectionId) !== record) return false;
      if (!record.subscriptions.has(channel) && record.subscriptions.size >= (input.maximumSubscriptions ?? 20)) {
        record.connection.close(1008, "Subscription limit exceeded");
        removeConnection(connectionId);
        return false;
      }
      record.subscriptions.add(channel);
      await send(record, { type: "subscribed", channel });
      return true;
    },

    unsubscribe(connectionId, channel) {
      connections.get(connectionId)?.subscriptions.delete(channel);
    },

    touch(connectionId) {
      const record = connections.get(connectionId);
      if (record) record.lastSeenAtMs = Date.now();
    },

    async acceptMessage(connectionId, payload) {
      const record = requireConnection(connectionId);
      const size = Buffer.byteLength(payload);
      if (size > (input.maximumMessageBytes ?? 16 * 1024)) {
        record.connection.close(1009, "Message too large");
        removeConnection(connectionId);
        return null;
      }
      const limit = await input.rateLimits.hit({
        key: `guildgate:ws:${connectionId}`,
        limit: input.messagesPerWindow ?? 30,
        windowMs: input.messageWindowMs ?? 10_000,
        nowMs: Date.now(),
      });
      if (!limit.allowed) {
        record.connection.close(1008, "Message rate exceeded");
        removeConnection(connectionId);
        return null;
      }
      record.lastSeenAtMs = Date.now();
      try {
        return JSON.parse(payload) as unknown;
      } catch {
        record.connection.close(1007, "Invalid JSON payload");
        removeConnection(connectionId);
        return null;
      }
    },

    async publish(event) {
      const payload = JSON.stringify(event);
      const tasks: Promise<void>[] = [];
      for (const record of connections.values()) {
        if (!record.subscriptions.has(event.channel)) continue;
        if ((record.connection.bufferedAmount ?? 0) > (input.maximumBufferedBytes ?? 512 * 1024)) {
          record.connection.close(1013, "Client is too slow");
          removeConnection(record.connection.id);
          continue;
        }
        tasks.push(send(record, payload).catch(() => {
          record.connection.close(1011, "Realtime delivery failed");
          removeConnection(record.connection.id);
        }));
      }
      await Promise.allSettled(tasks);
    },

    revokeSession(sessionIdHash) {
      for (const connectionId of bySession.get(sessionIdHash) ?? []) {
        const record = connections.get(connectionId);
        record?.connection.close(1008, "Session revoked");
        removeConnection(connectionId);
      }
      bySession.delete(sessionIdHash);
    },

    close() {
      clearInterval(heartbeat);
      for (const record of connections.values()) record.connection.close(1001, "Server shutdown");
      connections.clear();
      bySession.clear();
    },
  };

  function removeConnection(connectionId: string): void {
    const record = connections.get(connectionId);
    if (!record) return;
    connections.delete(connectionId);
    const ids = bySession.get(record.session.idHash);
    ids?.delete(connectionId);
    if (ids?.size === 0) bySession.delete(record.session.idHash);
  }

  function requireConnection(id: string): AttachedConnection {
    const record = connections.get(id);
    if (!record) throw new Error(`Unknown realtime connection: ${id}`);
    return record;
  }

  async function send(record: AttachedConnection, value: unknown): Promise<void> {
    const payload = typeof value === "string" ? value : JSON.stringify({ id: randomUUID(), ...value as object });
    await record.connection.send(payload);
  }

  async function checkConnections(): Promise<void> {
    if (checkingConnections) return;
    checkingConnections = true;
    try {
      const now = Date.now();
      for (const [id, record] of [...connections.entries()]) {
        if (connections.get(id) !== record) continue;
        if (now - record.lastSeenAtMs > (input.idleTimeoutMs ?? 60_000)) {
          record.connection.close(1001, "Idle timeout");
          removeConnection(id);
          continue;
        }
        if (now - record.createdAtMs > (input.maximumLifetimeMs ?? 6 * 60 * 60_000)) {
          record.connection.close(1001, "Connection lifetime reached");
          removeConnection(id);
          continue;
        }
        if (now - record.lastSessionValidatedAtMs >= (input.sessionValidationIntervalMs ?? 60_000)) {
          record.lastSessionValidatedAtMs = now;
          const session = await input.sessions.validate(record.sessionToken).catch(() => null);
          if (connections.get(id) !== record) continue;
          if (!session) {
            record.connection.close(1008, "Session expired or revoked");
            removeConnection(id);
          } else {
            record.session = session;
          }
        }
      }
    } finally {
      checkingConnections = false;
    }
  }
}
