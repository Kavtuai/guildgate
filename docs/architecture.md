# Architecture

GuildGate separates policy, transport, Discord access, storage, telemetry and presentation. Optional ecosystems stay behind small interfaces selected by the application.

## Main components

1. **Kernel** resolves sessions and applies origin, CSRF, maintenance, block, rate, authorization, idempotency, revision, lease, deadline, transaction, cache, audit and realtime rules.
2. **Session manager** stores hashes of opaque session tokens and enforces expiry, idle expiry, rotation, caps and revocation.
3. **Discord OAuth client** uses one-time browser-bound state, encrypted credential records and local return paths.
4. **Discord authorizer** checks user and bot permissions separately using `bigint`.
5. **Store contracts** let the application choose memory, Redis, PostgreSQL or custom services.
6. **Transaction adapters** provide a shared backend context and commit/rollback callbacks.
7. **Framework handlers** translate Fastify, Express or Hono requests into a common envelope.
8. **Realtime hub and adapters** authenticate connections, authorize subscriptions, apply limits and support replay.
9. **Outbox workers** claim committed events and publish them with retry-safe store state.
10. **Operator actions** expose paged session, audit, policy, rate and metrics services.
11. **Analytics tools** collect process and bot status, summarize points and generate SVG or table output.
12. **Telemetry hooks** map action spans and metrics to the backend selected by the application.

## Reliable write boundary

When a transaction adapter is configured, action work and outbox enqueue can use the same transaction context. Optimistic revision and fencing checks still belong in the durable write statement. Cache invalidation and general audit handling may happen after commit and cannot roll the domain change back.

## Consistency choices

- session and OAuth state consumption must fail closed
- idempotency, lease acquisition and outbox claims must be atomic in multi-instance deployments
- permission-sensitive writes should use live Discord data or a cache invalidated by gateway events
- metrics and read caches may use weaker consistency
- durable audit and outbox records need retention and backups

## Diagrams

- `docs/uml/components.mmd`
- `docs/uml/action-sequence.mmd`
- `docs/uml/transaction-sequence.mmd`
- `docs/uml/realtime-sequence.mmd`
- `docs/uml/analytics-components.mmd`
