# Threat model

## Protected assets

- Discord bot token and OAuth client secret
- OAuth access and refresh tokens
- session tokens and active sessions
- guild settings and moderation actions
- audit history and owner policies
- realtime events and resume history
- analytics records that may expose operational details
- availability of the dashboard and Discord API allowance

## Attackers considered

- unauthenticated internet clients
- authenticated users without permission for the target guild
- former guild managers with an open session
- malicious sites attempting cross-site HTTP or WebSocket use
- replay of OAuth callbacks, writes or idempotency keys
- concurrent writers and paused processes with expired locks
- slow clients and oversized realtime traffic
- application bugs that log secrets
- compromised low-privilege database accounts
- package-release and dependency supply-chain attackers

## Controls

| Threat | Control |
|---|---|
| Script access to session token | HttpOnly cookie design |
| Session-store disclosure | Stored token hashes |
| Session fixation | Opaque login token and scheduled rotation |
| CSRF | Exact origin and session-bound token on unsafe methods |
| OAuth callback replay | One-time state and browser nonce binding |
| Open redirect | Local return paths |
| Guild substitution | Parsed resource and server-side authorization |
| Stale Discord permission | Live check option or gateway-invalidated cache |
| Double submission | Idempotency state and response replay |
| Lost update | Optimistic revision and conditional database update |
| Expired lock owner writes | Renewable lease and fencing token |
| Slow upstream | AbortSignal, deadline, retry policy and circuit breaker |
| Cross-site socket | Origin allowlist and session resolution |
| Unauthorized subscription | Authorization callback per channel |
| Slow realtime client | Buffered-byte and event-queue limits |
| Event before commit | Transaction adapter and outbox enqueue |
| Worker collision | Claim lease and atomic row selection |
| Owner API misuse | Owner action authorization, CSRF, rate and audit |
| Secret exposure in logs | Redaction hooks and application responsibility |
| Malicious release | protected repository, CI, OIDC trusted publishing and provenance |

## Remaining risks

- A custom store can break atomic rules.
- A database update that ignores fencing tokens can accept a stale writer.
- Retry policy chosen by the application can repeat an unsafe external side effect.
- Realtime replay does not provide a global order across channels.
- Delivery can be duplicated after a publisher crash; consumers should be idempotent.
- Metric dimensions can create high cardinality and storage cost.
- Live Discord permission checks depend on Discord availability.
- Memory stores lose all state at process exit.
- The bundled audit is a maintainer review, not an independent third-party assessment. Deployments that require separate assurance should commission one using `EXTERNAL_REVIEW_GUIDE.md`.

## Out of scope

GuildGate does not secure a compromised host, configure TLS or a firewall, manage database roles, store secrets, create backups, define application schemas, choose bot moderation policy or replace incident response.

Review this model when session, OAuth, write, lock, outbox, owner, adapter, analytics or release behavior changes.
