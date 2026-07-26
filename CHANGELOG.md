# Changelog

All notable changes are recorded here. Semantic Versioning applies from `1.0.0`. Pre-1.0 milestones may contain API changes described in `MIGRATION.md`.

## 1.0.0 - 2026-07-26

### Added

- Stable `1.0` markers for action, store and realtime contracts.
- Reliable write controls, realtime transports, PostgreSQL and Redis adapters, operator APIs, monitoring, analytics, charts and telemetry hooks planned for the first stable line.
- Maintainer security audit, independent-review handoff, migration policy, operating limits and package security verification.

### Security

- Prevented retained realtime events from being replayed before channel authorization succeeds.
- Removed hidden internal details from server errors and redacted details that are explicitly exposed.
- Hardened SVG chart output against theme and label injection.
- Closed the concurrent PostgreSQL idempotency reservation race.
- Added renewable Redis leases with ownership checks and fencing tokens.
- Stopped retrying generic `TypeError` failures by default.
- Added bounded, cycle-safe serialization and broader secret-key redaction.
- Added runtime bounds for HTTP methods, cookies, actions, OAuth settings, locks and realtime channels.
- Closed malformed realtime JSON connections with protocol code 1007.
- Removed stored session metadata from operator output unless an application supplies an explicit public mapper.

### Changed

- Operator session metadata is private by default.
- Retry policy requires an explicit application rule for generic upstream exceptions.
- Release verification checks package identity, exports, CLI targets, secret patterns and OIDC publishing settings.

## 1.0.0-rc.1 - 2026-07-26

### Added

- Stable contract version markers for actions, stores and realtime adapters.
- Transaction adapters, commit and rollback hooks, optimistic revision checks and transactional outbox support.
- Renewable distributed leases, fencing tokens and lock-loss cancellation.
- Retry policies and a circuit breaker with open, half-open and reset states.
- WebSocket, Socket.IO and Server-Sent Events adapters.
- Realtime event sequences, resume cursors and session revocation bus contracts.
- Claim-based outbox workers for multi-instance delivery.
- PostgreSQL stores, migration SQL, transaction support, analytics records and realtime event logs.
- Hono and discord.js-compatible adapters.
- OpenTelemetry bridge hooks without a required telemetry SDK.
- Owner operator actions for sessions, audit, maintenance, blocks, policies, rate policies and metrics.
- Process and Discord bot monitoring, health probes and time-series analytics.
- SVG line, bar and donut charts plus framework-neutral table models.
- Store contract tests, a load harness and migration CLI.

### Changed

- Action execution can expose a transaction scope, retry attempt and fencing token.
- Realtime delivery can be committed with the domain transaction when a transaction adapter is configured.
- Framework request types are kept behind small compatibility interfaces.
- Documentation now separates release-candidate claims from the final security-review gate.

## 0.4.0 - 2026-07-26

### Added

- Hono handler, PostgreSQL adapter, discord.js-compatible adapter, OpenTelemetry hooks and owner inspection services.
- Status monitoring, analytics storage, charts and table models.

## 0.3.0 - 2026-07-26

### Added

- WebSocket, Socket.IO and SSE bindings.
- Authorized subscriptions, heartbeat, revocation disconnect, queue limits, event sequencing and claim-based outbox workers.

## 0.2.0 - 2026-07-26

### Added

- Optimistic concurrency, transaction hooks, cache invalidation, renewable leases, fencing tokens, retries, circuit breakers and operator session actions.

## 0.1.1 - 2026-07-26

### Fixed

- Added help output for both command-line tools.
- Made the writing checker operate on the current project directory.
- Missing documentation paths are skipped instead of causing an error.
- Added installed CLI regression tests.

## 0.1.0 - 2026-07-25

### Added

- Database-neutral storage contracts and memory reference stores.
- Redis stores for sessions, OAuth state, rate limits, cache, idempotency and locks.
- Opaque sessions with expiry, idle expiry, rotation, caps and revocation.
- Discord OAuth client, encrypted credential storage and `bigint` permission helpers.
- Guarded actions with policy, limits, authorization, idempotency, locks, deadlines, audit, cache and realtime delivery.
- Fastify and Express handlers, a realtime hub, an outbox dispatcher, bilingual errors, documentation, UML, CI and tests.
