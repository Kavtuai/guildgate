# GuildGate

GuildGate is a guarded action kernel and infrastructure toolkit for the server side of Discord bot dashboards. It keeps authentication, write safety, policy checks, realtime delivery, storage adapters, operator tools, monitoring and analytics behind contracts controlled by the application owner.

The package does not generate a dashboard UI and does not take ownership of application data. You choose the database, HTTP framework, Discord client, telemetry backend and chart placement.

Current package: `@kavtuai/guildgate@1.1.1`

Required runtime: Node.js 22 or newer

Version `1.1.1` keeps the `1.1` adapter contract stable and adds stricter action branding, operator payload validation, package inspection, secret scanning and a tokenless release path. The package does not claim an independent third-party audit.

## Install

```bash
npm install @kavtuai/guildgate
```

Optional integrations stay in the application:

```bash
npm install pg hono discord.js ws @opentelemetry/api
```

GuildGate does not import those packages. The adapters accept small compatible interfaces, which keeps the core package light and lets the application pin its own versions.

## Included

### Safe writes

- server-side sessions and session rotation
- exact-origin and CSRF checks
- idempotency replay and payload conflict detection
- optimistic revision checks
- transaction adapters and commit/rollback hooks
- tag-based cache invalidation
- distributed leases, renewal and fencing tokens
- deadlines, retries and circuit breakers
- audit records and owner policies

### Realtime

- authorized channel subscriptions
- WebSocket, Socket.IO and Server-Sent Events bindings
- heartbeat and session revalidation
- immediate disconnect after local or broadcast revocation
- buffered-byte and event-queue limits
- channel sequences and resume cursors
- claim-based outbox workers for multiple instances

### Ecosystem

- Fastify, Express and Hono action handlers
- PostgreSQL store bundle and migration SQL
- Redis stores for shared sessions, limits, cache, idempotency and locks
- discord.js-compatible guild permission adapter
- backend-neutral OpenTelemetry hooks
- memory test harness and stable store contract tests
- doctor, writing-check and migration CLI commands

### Operations and analytics

- owner-only maintenance and subject block controls
- paged session, audit and policy services
- rate policy registry and reset controls
- server process and Discord bot sampling
- custom health probes
- time-series storage and bucket summaries
- line, bar and donut SVG renderers
- table models for dashboard views

## Reliability model

GuildGate treats a committed domain write as final even when a cache, audit, realtime or observer callback fails afterward. Post-commit problems are reported in response metadata and telemetry; they do not trigger a false rollback or repeat the domain operation. Nested PostgreSQL work uses savepoints and releases its callbacks to the outer transaction only after the savepoint succeeds.

Idempotency records carry a reservation identifier. Completion and cleanup are compare-and-set operations, so an expired worker cannot overwrite or delete a newer reservation. Action deadlines return a `504` at the configured boundary even when application code ignores `AbortSignal`. When a timed-out idempotent operation later settles, GuildGate retains reservation ownership and the distributed lease while the bounded late-settlement observer is active, then records a committed result for safe replay. `reliability.maximumLateSettlementMs` limits how long that observation can retain resources. The physical operation must still honor the supplied signal and validate fencing tokens at the durable write boundary when early cancellation is required.

WebSocket and Socket.IO messages pass through the same payload, rate, activity, subscription and backpressure guards. Subscription capacity is rechecked after asynchronous authorization, broken connections are removed after delivery failure, and revocation listeners are isolated from one another. Audit pagination uses an opaque `(createdAt, id)` cursor. Redis cache retagging and tag cleanup are atomic, tag indexes receive TTLs, and official memory, Redis and PostgreSQL session stores enforce the per-user session cap inside the store operation.

The transactional outbox remains at-least-once by design. Claims are leased, dispatch concurrency and batch size are bounded, and stored publisher errors are sanitized and truncated. Consumers must deduplicate by event ID before applying external side effects. PostgreSQL rate-limit updates are serialized per bucket with transaction-scoped advisory locks, and Discord OAuth token refresh uses a distributed single-flight lease.

## Minimal setup

```ts
import {
  createGuildGate,
  createMemoryStoreBundle,
  createMemoryTransactionAdapter,
} from "@kavtuai/guildgate";

const stores = createMemoryStoreBundle();

const gate = createGuildGate({
  app: {
    name: "My Discord Dashboard",
    environment: "development",
    baseUrl: "http://localhost:3000",
  },
  owners: ["YOUR_DISCORD_USER_ID"],
  security: {
    allowedOrigins: ["http://localhost:3000"],
    csrfSecret: process.env.GUILDGATE_CSRF_SECRET!,
    auditIpSalt: process.env.GUILDGATE_AUDIT_IP_SALT!,
    session: {
      ttlMs: 7 * 24 * 60 * 60_000,
      idleTimeoutMs: 30 * 60_000,
      rotateAfterMs: 15 * 60_000,
      maximumSessionsPerUser: 5,
    },
  },
  stores,
  transactions: createMemoryTransactionAdapter(),
  reliability: {
    maximumLateSettlementMs: 5 * 60_000,
  },
});
```

The memory adapter is intended for tests and local tools. Its data disappears when the process stops.

## A guarded write action

```ts
let currentRevision = 4;

const updateSettings = gate.action({
  name: "guild.settings.update",

  parse(value) {
    const input = value as {
      guildId: string;
      expectedRevision: number;
      prefix: string;
    };

    if (!input.guildId || !Number.isInteger(input.expectedRevision)) {
      throw new Error("Invalid settings input");
    }

    return input;
  },

  resource: (input) => ({ type: "guild", id: input.guildId }),

  rateLimit: {
    limit: 20,
    windowMs: 60_000,
  },

  idempotency: {
    ttlMs: 10 * 60_000,
  },

  optimistic: {
    expected: (input) => input.expectedRevision,
    current: async () => currentRevision,
    resource: (input) => `guild:${input.guildId}`,
  },

  concurrency: {
    key: (_context, input) => `settings:${input.guildId}`,
    ttlMs: 8_000,
    renewEveryMs: 2_000,
    waitMs: 250,
  },

  retry: {
    attempts: 3,
    baseDelayMs: 50,
    maximumDelayMs: 500,
  },

  circuitBreaker: {
    failureThreshold: 5,
    resetAfterMs: 30_000,
  },

  transaction: {
    isolation: "serializable",
    hooks: {
      afterCommit(result) {
        console.log("Committed revision", result.revision);
      },
    },
  },

  timeoutMs: 5_000,

  async execute(context, input) {
    context.signal.throwIfAborted();
    context.transaction;
    context.fencingToken;

    currentRevision += 1;

    return {
      guildId: input.guildId,
      prefix: input.prefix,
      revision: currentRevision,
    };
  },

  cache: {
    invalidateTags: (result) => [`guild:${result.guildId}`],
  },

  realtime: {
    delivery: "outbox",
    events: (result) => [{
      event: "guild.settings.updated",
      channel: `guild:${result.guildId}`,
      data: result,
    }],
  },

  audit: {
    changes: (result) => result,
  },
});
```

Unsafe HTTP methods require an approved origin and a session-bound CSRF token unless an action explicitly disables the check. A state-changing action should normally keep both checks enabled.

## HTTP adapters

```ts
import { fastifyActionHandler } from "@kavtuai/guildgate/fastify";

app.patch(
  "/api/guilds/:guildId/settings",
  fastifyActionHandler(gate, updateSettings, {
    input: (request) => ({
      ...(request.body as object),
      guildId: (request.params as { guildId: string }).guildId,
    }),
  }),
);
```

Equivalent entry points are available at:

```ts
import { expressActionHandler } from "@kavtuai/guildgate/express";
import { honoActionHandler } from "@kavtuai/guildgate/hono";
```

## PostgreSQL

```ts
import { Pool } from "pg";
import { createPostgresAdapter } from "@kavtuai/guildgate/postgres";

const postgres = createPostgresAdapter({
  pool: new Pool({ connectionString: process.env.DATABASE_URL }),
});

await postgres.migrate();

const gate = createGuildGate({
  // app and security settings
  stores: postgres.stores,
  transactions: postgres.transactions,
});
```

The PostgreSQL bundle contains sessions, OAuth state, credentials, limits, cache, idempotency, leases, audit, policies, outbox rows, realtime sequences and analytics points. Outbox claims use row locks with `SKIP LOCKED` so separate workers can claim different rows.

Print the migration without connecting to a database:

```bash
npx guildgate-migration --prefix guildgate
```

Custom database implementations can use the contracts in `GuildGateStores` and verify behavior with `runStoreContract()`.

## Realtime transports

The core hub owns authentication, origin checks, subscription authorization, limits and session validation. A transport adapter connects it to the network library selected by the application.

```ts
import {
  attachWebSocket,
  createRealtimeHub,
  MemoryRealtimeEventLog,
} from "@kavtuai/guildgate/realtime";

const eventLog = new MemoryRealtimeEventLog();

const hub = createRealtimeHub({
  sessions: gate.sessions,
  rateLimits: gate.config.stores.rateLimits,
  allowedOrigins: gate.config.security.allowedOrigins,
});

await attachWebSocket({
  socket,
  hub,
  origin: request.headers.origin,
  sessionToken,
  eventLog,
  authorize: async ({ userId, channel }) => {
    return canUserOpenChannel(userId, channel);
  },
});
```

The same module exports `attachSocketIo()`, `createServerSentEventStream()`, `MemorySessionRevocationBus`, `createSequencedPublisher()` and `createOutboxWorker()`.

## Bot and server monitoring

```ts
import {
  MemoryAnalyticsStore,
  StatusMonitor,
  createDiscordJsBotCollector,
} from "@kavtuai/guildgate/analytics";

const analytics = new MemoryAnalyticsStore();

const monitor = new StatusMonitor({
  store: analytics,
  intervalMs: 30_000,
  bot: createDiscordJsBotCollector(discordClient),
  probes: [
    {
      id: "database",
      label: "PostgreSQL",
      timeoutMs: 2_000,
      async check(signal) {
        await pingDatabase(signal);
        return { status: "operational" };
      },
    },
  ],
});

monitor.start();
```

Recorded metrics include process memory, CPU time, event-loop delay, uptime, bot readiness, gateway latency, guild count, user reach, shard count and command count. Applications may write any additional `MetricPoint` values.

## Charts and tables

```ts
import {
  bucketMetrics,
  buildAnalyticsTable,
  renderLineChartSvg,
} from "@kavtuai/guildgate/analytics";

const points = await analytics.query({
  names: ["bot.websocket.ping_ms"],
  from: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
});

const buckets = bucketMetrics(points, 5 * 60_000);

const svg = renderLineChartSvg({
  title: "Gateway latency",
  labels: buckets.map((bucket) => bucket.start),
  series: [{
    name: "p95",
    values: buckets.map((bucket) => bucket.p95),
  }],
});
```

`renderBarChartSvg()` and `renderDonutChartSvg()` return standalone SVG strings. `buildAnalyticsTable()` returns columns and rows that can be rendered by React, Vue, Svelte, plain HTML or a JSON API.

## Session and owner APIs

```ts
import { createOperatorActions } from "@kavtuai/guildgate/operator";

const operator = createOperatorActions({
  kernel: gate,
  analytics,
});

app.get("/api/sessions", fastifyActionHandler(gate, operator.listSessions));
app.delete("/api/sessions/:sessionId", fastifyActionHandler(gate, operator.revokeSession));
app.get("/api/owner/audit", fastifyActionHandler(gate, operator.listAudit));
app.get("/api/owner/policies", fastifyActionHandler(gate, operator.inspectPolicies));
app.get("/api/owner/metrics", fastifyActionHandler(gate, operator.queryMetrics));
```

Owner actions use the `owners` list supplied to `createGuildGate()`. Maintenance changes, block operations and audit queries still pass through session, origin, CSRF, rate and audit behavior defined by the action.

## OpenTelemetry

```ts
import * as otel from "@opentelemetry/api";
import { createOpenTelemetryHooks } from "@kavtuai/guildgate/telemetry";

const telemetry = createOpenTelemetryHooks(otel, {
  name: "my-dashboard",
  version: "2.4.0",
});
```

Pass `telemetry` to `createGuildGate()`. The bridge records action spans, counts and duration histograms without forcing an SDK or exporter.

## Discord OAuth and permissions

Discord OAuth state is single-use and bound to the browser that started login. Tokens are stored through the configured credential store after encryption by the application key ring.

Permission helpers use `bigint` and cover user permissions, bot permissions, guild ownership and role hierarchy. The `discordjs` entry point can read compatible guild and member objects from a discord.js client without adding discord.js as a dependency of GuildGate.

## Validation commands

```bash
npm run typecheck
npm test
npm run test:coverage
npm run test:services
npm run pack:check
npm run test:load
npx guildgate-doctor --help
npx guildgate-writing-check --help
npx guildgate-migration --help
```

## Release status

`1.1.1` is the current stable release. The local deterministic suite contains 80 test definitions: 78 pass without external services and two live-service tests run against PostgreSQL and Redis in CI. The release gate also enforces coverage thresholds, package identity checks, secret scanning, a 5,000-operation load harness and packed-tarball inspection. The live-service tests run in CI with disposable PostgreSQL and Redis services; application-specific Discord permissions, reverse-proxy policy and domain authorization remain part of the consuming application test suite.

See:

- [Project roadmap](https://github.com/Kavtuai/guildgate/blob/main/ROADMAP.md)
- [MIGRATION.md](MIGRATION.md)
- [OPERATING_LIMITS.md](OPERATING_LIMITS.md)
- [SECURITY.md](SECURITY.md)
- [Maintainer security review](https://github.com/Kavtuai/guildgate/blob/main/SECURITY_AUDIT.md)
- [External review guide](https://github.com/Kavtuai/guildgate/blob/main/EXTERNAL_REVIEW_GUIDE.md)
- [docs/threat-model.md](docs/threat-model.md)
- [docs/contracts/stable-adapters.md](docs/contracts/stable-adapters.md)
- [docs/configuration.md](docs/configuration.md)
- [docs/analytics.md](docs/analytics.md)

## License

MIT
