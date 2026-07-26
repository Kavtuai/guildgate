import { Hono } from "hono";
import { createHonoHandler } from "@kavtuai/guildgate/hono";
import { createGuildGate, createMemoryStoreBundle } from "@kavtuai/guildgate";

const gate = createGuildGate({
  app: { name: "GuildGate Hono", environment: "development", baseUrl: "http://localhost:3000" },
  owners: ["owner-id"],
  security: {
    allowedOrigins: ["http://localhost:3000"],
    csrfSecret: process.env.GUILDGATE_CSRF_SECRET!,
    auditIpSalt: process.env.GUILDGATE_AUDIT_IP_SALT!,
    session: { ttlMs: 86_400_000, idleTimeoutMs: 1_800_000, rotateAfterMs: 900_000, maximumSessionsPerUser: 5 },
  },
  stores: createMemoryStoreBundle(),
});

const health = gate.action({ name: "health.read", authentication: "optional", csrf: "disabled", async execute() { return { status: "ok" }; } });
const app = new Hono();
app.get("/health", createHonoHandler(gate, health));
export default app;
