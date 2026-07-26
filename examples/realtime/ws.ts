import { WebSocketServer } from "ws";
import { attachWebSocket, createRealtimeHub } from "@kavtuai/guildgate/realtime";

export function attachRealtime(server: unknown, gate: any) {
  const wss = new WebSocketServer({ server });
  const hub = createRealtimeHub({
    sessions: gate.sessions,
    rateLimits: gate.config.stores.rateLimits,
    allowedOrigins: gate.config.security.allowedOrigins,
  });

  wss.on("connection", async (socket, request) => {
    await attachWebSocket({
      socket,
      hub,
      origin: request.headers.origin,
      sessionToken: readSessionCookie(request.headers.cookie),
      authorize: async ({ userId, channel }) => canSubscribe(userId, channel),
    });
  });
}

declare function readSessionCookie(cookie: string | undefined): string | undefined;
declare function canSubscribe(userId: string, channel: string): Promise<boolean>;
