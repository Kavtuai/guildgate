import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { createGuildGate, createMemoryStoreBundle } from "@kavtuai/guildgate";
import { fastifyActionHandler } from "@kavtuai/guildgate/fastify";

const app = Fastify({ logger: true });
await app.register(cookie);

const gate = createGuildGate({
  app: {
    name: "GuildGate Fastify Example",
    environment: "development",
    baseUrl: "http://localhost:3000",
  },
  owners: [process.env.BOT_OWNER_ID ?? "owner-1"],
  locale: { default: "en" },
  security: {
    allowedOrigins: ["http://localhost:3000"],
    csrfSecret: process.env.GUILDGATE_CSRF_SECRET ?? "development-csrf-secret-change-this-123456",
    auditIpSalt: process.env.GUILDGATE_AUDIT_IP_SALT ?? "development-audit-salt",
    session: {
      ttlMs: 12 * 60 * 60_000,
      idleTimeoutMs: 30 * 60_000,
      rotateAfterMs: 15 * 60_000,
      maximumSessionsPerUser: 5,
    },
  },
  stores: createMemoryStoreBundle(),
});

const settings = new Map<string, { revision: number; locale: string }>();

const updateSettings = gate.action({
  name: "guild.settings.update",
  parse(value) {
    const body = value as Record<string, unknown>;
    if (typeof body.guildId !== "string") throw new Error("guildId is required");
    if (typeof body.locale !== "string") throw new Error("locale is required");
    if (typeof body.revision !== "number") throw new Error("revision is required");
    return { guildId: body.guildId, locale: body.locale, revision: body.revision };
  },
  resource: (input) => ({ type: "guild", id: input.guildId }),
  rateLimit: { limit: 20, windowMs: 60_000 },
  idempotency: { ttlMs: 10 * 60_000 },
  concurrency: { key: (_context, input) => `settings:${input.guildId}` },
  authorize: (context) => ({ allowed: Boolean(context.userId) }),
  async execute(_context, input) {
    const current = settings.get(input.guildId) ?? { revision: 0, locale: "en" };
    if (current.revision !== input.revision) {
      throw new Error(`revision conflict: current revision is ${current.revision}`);
    }
    const next = { revision: current.revision + 1, locale: input.locale };
    settings.set(input.guildId, next);
    return { guildId: input.guildId, ...next };
  },
  audit: { changes: (result) => result },
});

app.post("/dev/login", async (_request, reply) => {
  const login = await gate.createSession({ userId: "user-1", locale: "en" });
  reply.header("set-cookie", login.setCookie);
  return { csrfToken: login.csrfToken };
});

app.patch("/api/guild-settings", fastifyActionHandler(gate, updateSettings));

await app.listen({ host: "127.0.0.1", port: 3000 });
