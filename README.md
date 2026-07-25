# GuildGate

[Turkish documentation](./README.tr.md)

GuildGate is a TypeScript library for the server side of Discord bot dashboards. It handles session records, Discord OAuth state, CSRF checks, exact-origin checks, guild permission checks, request limits, idempotency, resource locks, timeouts, cache invalidation, audit records, outbox events, and authenticated realtime subscriptions.

It does not generate a user interface and it does not own your database. Each storage feature is an interface. An application can use PostgreSQL, MySQL, MongoDB, SQLite, Redis, an existing ORM, or a private storage service.

Current package: `@kavtuai/guildgate`  
Current release: `0.1.0`  
Required runtime: Node.js 22 or newer

## Status

This repository is an initial public release candidate. The TypeScript build and included tests pass. Live Discord OAuth, a production Redis server, and third-party database drivers still need integration tests in the target application before deployment.

No library can promise that an application has no security defects. GuildGate reduces repeated security work, rejects unsafe production settings, and gives application owners explicit policy controls. A production service should still use code review, dependency review, monitoring, backups, and an external security review when its risk warrants one.

## Install

After the package is published:

```bash
npm install @kavtuai/guildgate
```

To test this source archive before publishing:

```bash
npm install
npm test
```

## What is included

- Opaque server-side sessions. Raw session tokens are not stored.
- Session expiry, idle expiry, rotation, per-user session caps, and revocation.
- Discord authorization-code login with one-time `state` records and a browser nonce cookie.
- Encrypted OAuth access and refresh token storage through a caller-supplied keyring.
- Exact origin checks and session-bound CSRF tokens for write requests.
- Discord permission parsing with `BigInt`.
- User and bot permission checks for a guild.
- A guarded `action()` API for dashboard reads and writes.
- Per-action limits, idempotency keys, resource locks, request deadlines, audit records, cache tags, and realtime events.
- Memory stores for tests and local development.
- Redis implementations for short-lived and distributed state.
- Framework adapters for Fastify and Express without runtime framework dependencies.
- An authenticated realtime hub for WebSocket adapters.
- English and Turkish error messages with per-application overrides.
- Mermaid UML files, a threat model, store contracts, release notes, and publishing workflows.

## Five-minute local example

Memory storage is suitable for tests and a single local process. It is not a production database.

```ts
import {
  createGuildGate,
  createMemoryStoreBundle,
} from "@kavtuai/guildgate";

const stores = createMemoryStoreBundle();

const gate = createGuildGate({
  app: {
    name: "My Discord Dashboard",
    environment: "development",
    baseUrl: "http://localhost:3000",
  },
  owners: [process.env.BOT_OWNER_ID!],
  locale: {
    default: "en",
    messages: {
      en: { MAINTENANCE_MODE: "Settings are paused during maintenance." },
    },
  },
  security: {
    allowedOrigins: ["http://localhost:3000"],
    csrfSecret: process.env.GUILDGATE_CSRF_SECRET!,
    auditIpSalt: process.env.GUILDGATE_AUDIT_IP_SALT!,
    session: {
      ttlMs: 12 * 60 * 60_000,
      idleTimeoutMs: 30 * 60_000,
      rotateAfterMs: 15 * 60_000,
      maximumSessionsPerUser: 5,
    },
  },
  stores,
});
```

Secrets used by this example must contain enough random bytes. Generate them outside source control:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## A guarded dashboard action

The action definition keeps checks beside the operation they protect.

```ts
const updateSettings = gate.action({
  name: "guild.settings.update",

  parse(value) {
    const body = value as Record<string, unknown>;
    if (typeof body.guildId !== "string") throw new Error("guildId is required");
    if (typeof body.revision !== "number") throw new Error("revision is required");
    return {
      guildId: body.guildId,
      revision: body.revision,
      settings: body.settings,
    };
  },

  resource: (input) => ({ type: "guild", id: input.guildId }),

  rateLimit: {
    limit: 20,
    windowMs: 60_000,
    key: (context, input) => `${context.userId}:${input.guildId}`,
  },

  idempotency: {
    ttlMs: 10 * 60_000,
    scope: (context, input) => `${context.userId}:${input.guildId}`,
  },

  concurrency: {
    key: (_context, input) => `guild-settings:${input.guildId}`,
    ttlMs: 8_000,
    waitMs: 500,
  },

  timeoutMs: 5_000,

  authorize: async (context, input) => {
    // Replace this with createDiscordGuildAuthorizer(...).require(...),
    // or use the policy service already present in your application.
    return context.userId
      ? { allowed: true }
      : { allowed: false, code: "AUTHENTICATION_REQUIRED" };
  },

  async execute(context, input) {
    // The application owns the transaction and the revision check.
    return database.transaction(async (tx) => {
      return tx.guildSettings.updateWithRevision({
        guildId: input.guildId,
        expectedRevision: input.revision,
        settings: input.settings,
        actorId: context.userId!,
      });
    });
  },

  audit: {
    changes: (result) => ({ revision: result.revision }),
  },

  cache: {
    invalidateTags: (result) => [`guild:${result.guildId}`],
  },

  realtime: {
    delivery: "outbox",
    events: (result) => [{
      event: "guild.settings.updated",
      channel: `guild:${result.guildId}`,
      data: { revision: result.revision },
    }],
  },
});
```

A browser write request must include the session cookie, the CSRF token, and an idempotency key:

```http
PATCH /api/guilds/123/settings
Origin: https://dashboard.example.com
X-CSRF-Token: <session-bound-token>
Idempotency-Key: <random-request-id>
```

## Discord login

```ts
import { createTokenCipher } from "@kavtuai/guildgate";
import { createDiscordOAuth } from "@kavtuai/guildgate/discord";

const cipher = createTokenCipher({
  activeKeyId: "2026-01",
  keys: {
    "2026-01": process.env.GUILDGATE_TOKEN_KEY_BASE64!,
  },
});

const discord = createDiscordOAuth({
  kernel: gate,
  cipher,
  config: {
    clientId: process.env.DISCORD_CLIENT_ID!,
    clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    redirectUri: "https://dashboard.example.com/auth/discord/callback",
    scopes: ["identify", "guilds"],
  },
});
```

Login start:

```ts
const login = await discord.beginLogin({ returnTo: "/dashboard", locale: "en" });
response.header("set-cookie", login.stateCookie);
response.redirect(login.authorizationUrl);
```

Callback:

```ts
const result = await discord.completeLogin({
  code: request.query.code,
  state: request.query.state,
  stateCookie: request.cookies["__Host-guildgate.oauth"],
});

response.header("set-cookie", [result.setCookie, result.clearStateCookie]);
response.redirect(result.returnTo);
```

The OAuth callback accepts only a local return path. It will not redirect to a caller-supplied external host.

## Guild permission checks

```ts
import { createDiscordGuildAuthorizer } from "@kavtuai/guildgate/discord";

const guildAccess = createDiscordGuildAuthorizer({
  oauth: discord,
  botToken: process.env.DISCORD_BOT_TOKEN!,
  botUserId: process.env.DISCORD_BOT_USER_ID!,
  cache: gate.cache,
});

const saveAction = gate.action({
  name: "guild.settings.save",
  parse: parseSettings,
  resource: (input) => ({ type: "guild", id: input.guildId }),
  authorize: guildAccess.require({
    guildId: (input) => input.guildId,
    userPermissions: ["MANAGE_GUILD"],
    botPermissions: ["VIEW_CHANNEL", "MANAGE_ROLES"],
    consistency: "live",
  }),
  execute: saveSettings,
});
```

Use live checks for writes that change Discord or security-sensitive settings. Short cached checks are suitable for low-risk display data. Invalidate permission cache entries when member roles, guild roles, or bot membership change.

## Database choice

`GuildGateStores` is the complete storage contract:

```ts
interface GuildGateStores {
  sessions: SessionStore;
  oauthStates: OAuthStateStore;
  credentials: OAuthCredentialStore;
  rateLimits: RateLimitStore;
  cache: CacheStore;
  idempotency: IdempotencyStore;
  locks: LockStore;
  audit: AuditStore;
  outbox: OutboxStore;
  policies: PolicyStore;
}
```

A project may put durable records in its main database and short-lived records in Redis:

```ts
import { composeStores, createMemoryStoreBundle } from "@kavtuai/guildgate";
import {
  createRedisEphemeralStores,
  fromNodeRedis,
} from "@kavtuai/guildgate/redis";

const temporary = createRedisEphemeralStores(fromNodeRedis(redis), {
  prefix: "mybot:guildgate",
});

const stores = composeStores(createMemoryStoreBundle(), {
  ...temporary,
  credentials: postgresCredentialStore,
  audit: postgresAuditStore,
  outbox: postgresOutboxStore,
  policies: postgresPolicyStore,
});
```

The memory fallback in that snippet is shown to explain composition. A production application should provide durable implementations for every record it must retain across restarts.

See [Custom stores](./docs/custom-stores.md) for contracts and transaction notes.

## Fastify and Express adapters

The adapters use structural request and response types, so GuildGate does not install either framework.

```ts
import { fastifyActionHandler } from "@kavtuai/guildgate/fastify";

fastify.patch(
  "/api/guilds/:guildId/settings",
  fastifyActionHandler(gate, updateSettings),
);
```

```ts
import { expressActionHandler } from "@kavtuai/guildgate/express";

app.patch(
  "/api/guilds/:guildId/settings",
  expressActionHandler(gate, updateSettings),
);
```

## Realtime access

`createRealtimeHub()` does not open a socket server. Connect it to `ws`, uWebSockets.js, Socket.IO, Bun, or another transport through the small `RealtimeConnection` interface.

Every connection must pass an allowed `Origin` and a valid session token. Each channel subscription has its own authorization callback. The hub also applies message size limits, message-rate limits, idle expiry, maximum connection lifetime, subscription caps, and slow-client handling.

See [Architecture](./docs/architecture.md) and the [realtime sequence](./docs/uml/realtime-sequence.mmd).

## Owner controls

The configured owner IDs can be used by the application to expose protected management routes. The kernel includes methods for:

```ts
await gate.owner.setMaintenance({ enabled: true, reason: "database migration" });
await gate.owner.block({ subjectType: "user", subjectId: "123", reason: "abuse" });
await gate.owner.unblock("user", "123");
await gate.revokeUserSessions("123");
```

Owner routes must still pass session, CSRF, origin, rate-limit, and audit checks. Do not call these methods from public routes without an owner authorization check.

## Production rules

GuildGate rejects these production settings:

- A non-HTTPS application base URL.
- An empty origin allowlist.
- An HTTP or localhost origin.
- A session cookie with `Secure` disabled.
- A Discord callback URL that does not use HTTPS.
- Short CSRF and audit hashing secrets.

Application responsibilities remain:

- Use a trusted reverse-proxy configuration and obtain the real client IP safely.
- Keep bot tokens, OAuth secrets, encryption keys, and database credentials outside source control.
- Run database changes in transactions where the driver supports them.
- Apply optimistic revision checks when multiple managers can edit one record.
- Keep audit and outbox data under retention policies.
- Back up durable records and test restore procedures.
- Pass cancellation signals to database and HTTP clients where supported.
- Review Discord permission and API changes before each major release.

## Repository checks

```bash
npm run typecheck
npm test
npm run pack:check
node ./bin/guildgate-doctor.mjs
```

The doctor command reads environment variables and reports missing or unsafe deployment settings. It does not send secrets anywhere.

## Documentation

- [Setup and first release](./docs/setup.md)
- [Architecture](./docs/architecture.md)
- [Custom storage drivers](./docs/custom-stores.md)
- [Owner management routes](./docs/owner-management.md)
- [Threat model](./docs/threat-model.md)
- [Writing rules](./docs/WRITING_STYLE.md)
- [Research notes](./docs/research-notes.md)
- [Local test report](./TEST_REPORT.md)
- [Release plan](./ROADMAP.md)
- [Security reporting](./SECURITY.md)
- [UML files](./docs/uml)

## License

MIT. See [LICENSE](./LICENSE).
