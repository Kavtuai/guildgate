import { Pool } from "pg";
import { createGuildGate } from "@kavtuai/guildgate";
import { createPostgresAdapter } from "@kavtuai/guildgate/postgres";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const postgres = createPostgresAdapter({ pool, prefix: "guildgate" });

// Run through the application's migration system, not every instance at startup.
console.log(postgres.migrationSql);

export const gate = createGuildGate({
  app: { name: "Dashboard", environment: "production", baseUrl: "https://dashboard.example.com" },
  owners: [process.env.BOT_OWNER_ID!],
  security: {
    allowedOrigins: ["https://dashboard.example.com"],
    csrfSecret: process.env.GUILDGATE_CSRF_SECRET!,
    auditIpSalt: process.env.GUILDGATE_AUDIT_IP_SALT!,
    session: { ttlMs: 604_800_000, idleTimeoutMs: 1_800_000, rotateAfterMs: 900_000, maximumSessionsPerUser: 5 },
  },
  stores: postgres.stores,
  transactions: postgres.transactions,
});
