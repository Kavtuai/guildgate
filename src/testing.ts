import { MemoryAnalyticsStore } from "./analytics/store.js";
import { runStoreContract } from "./contracts.js";
import { createMemoryStoreBundle } from "./memory-store.js";
import { createGuildGate, type GuildGateConfig } from "./kernel.js";
import { createMemoryTransactionAdapter } from "./transactions.js";
import type { SupportedLocale } from "./types.js";

export function createGuildGateTestHarness(overrides?: Partial<GuildGateConfig>) {
  const stores = createMemoryStoreBundle();
  const analytics = new MemoryAnalyticsStore();
  const transactions = overrides?.transactions ?? createMemoryTransactionAdapter();
  const defaultSecurity: GuildGateConfig["security"] = {
    allowedOrigins: ["http://localhost:3000"],
    csrfSecret: "test-csrf-secret-that-is-long-enough-123456",
    auditIpSalt: "test-audit-salt-123456",
    session: {
      ttlMs: 60 * 60_000,
      idleTimeoutMs: 30 * 60_000,
      rotateAfterMs: 15 * 60_000,
      maximumSessionsPerUser: 5,
    },
  };
  const config: GuildGateConfig = {
    app: {
      name: overrides?.app?.name ?? "GuildGate Test",
      environment: overrides?.app?.environment ?? "test",
      baseUrl: overrides?.app?.baseUrl ?? "http://localhost:3000",
    },
    owners: overrides?.owners ?? ["owner-1"],
    locale: overrides?.locale ?? { default: "en" },
    security: {
      ...defaultSecurity,
      ...overrides?.security,
      session: {
        ...defaultSecurity.session,
        ...overrides?.security?.session,
      },
    },
    stores: overrides?.stores ?? stores,
    realtime: overrides?.realtime,
    transactions,
    telemetry: overrides?.telemetry,
    audit: overrides?.audit,
    reliability: overrides?.reliability,
    clock: overrides?.clock,
  };
  const kernel = createGuildGate(config);

  return {
    kernel,
    stores: config.stores,
    analytics,
    transactions,
    runStoreContract: () => runStoreContract(() => config.stores),
    async login(userId = "user-1", locale: SupportedLocale = "en") {
      return kernel.createSession({ userId, locale });
    },
    request(input: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: unknown;
      sessionToken?: string;
      csrfToken?: string;
      idempotencyKey?: string;
      locale?: SupportedLocale;
      signal?: AbortSignal;
    }) {
      return {
        method: input.method ?? "POST",
        path: "/test",
        input: input.body,
        origin: "http://localhost:3000",
        ip: "127.0.0.1",
        userAgent: "guildgate-test",
        sessionToken: input.sessionToken,
        csrfToken: input.csrfToken,
        idempotencyKey: input.idempotencyKey,
        locale: input.locale ?? "en",
        signal: input.signal,
      } as const;
    },
  };
}
