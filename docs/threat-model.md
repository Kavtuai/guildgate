# Threat model

## Protected assets

- Discord bot token and OAuth client secret.
- OAuth access and refresh tokens.
- Session tokens and active sessions.
- Guild settings and moderation actions.
- Audit history and owner policies.
- Realtime events that may reveal guild state.
- Availability of the dashboard and Discord API allowance.

## Attackers considered

- An unauthenticated internet client.
- An authenticated Discord user without permission for the target guild.
- A former guild manager whose role was removed while a session remains open.
- A malicious site attempting cross-site requests or WebSocket connections.
- A user replaying a request, OAuth callback, or idempotency key.
- A user sending many requests, large socket messages, or slow-client backpressure.
- An application bug that logs or returns secrets.
- A compromised low-privilege database account.
- A package supply-chain attacker.

## Main controls

| Threat | Control |
|---|---|
| Session theft from script | HttpOnly cookie; no localStorage requirement |
| Session database leak | Only token hashes are stored |
| Session fixation | New opaque token on login and scheduled rotation |
| CSRF | Exact origin check plus session-bound token on unsafe methods |
| OAuth login CSRF or callback replay | One-time state plus browser nonce binding |
| Open redirect | Local return paths only |
| Guild ID substitution | Resource and permission checks run on parsed server input |
| Stale manager permission | Live authorization option for writes |
| Bot overreach | Required bot permissions are checked separately |
| Double submission | Idempotency reservation and response replay |
| Concurrent setting overwrite | Resource lock; application revision check recommended |
| Request flooding | Per-action store-backed limits |
| Slow upstream | Deadline, abort signal, retry policy, and circuit breaker utility |
| WebSocket cross-site use | Origin allowlist and session resolution |
| Unauthorized channel subscription | Authorization callback per channel |
| Socket memory pressure | Payload, subscription, lifetime, idle, and buffered-byte caps |
| Secret exposure in audit | Known-key redaction and caller responsibility |
| Event before commit | Durable outbox option |
| Owner policy loss after restart | Durable PolicyStore implementation |
| Malicious package release | Protected repository, CI tests, npm trusted publishing, provenance |

## Out of scope

GuildGate does not:

- Secure a compromised host or stolen deployment secret.
- Configure TLS, a reverse proxy, a firewall, database roles, backups, or operating-system updates.
- Validate application-specific setting schemas unless the action supplies a parser.
- Create database transactions for an unknown driver.
- Decide which Discord command or moderation operation is appropriate.
- Prevent a bot owner from intentionally granting excessive access in application policy.
- Replace dependency review or incident response.

## Open risks in 0.1.0

- Redis leases have no renewal helper. Keep the lock TTL above the expected operation time or use a driver with stronger locking.
- The included Discord REST helper has a small retry policy but does not coordinate a process-wide Discord route bucket. Reuse a Discord library REST manager when the application already has one.
- General audit writes happen after the action result. Put mandatory domain audit records inside the database transaction.
- Live Discord authorization adds API requests and can be affected by Discord availability. A bot gateway cache with event-based invalidation may be preferable at scale.
- The memory store uses one process and loses records on restart.

## Review triggers

Review this model when:

- A new store or framework adapter is added.
- Owner APIs are exposed.
- Realtime client-to-server commands are added.
- Premium, billing, or account linking is added.
- A Discord permission flag or OAuth behavior changes.
- A release changes session, token, idempotency, lock, audit, or outbox behavior.
