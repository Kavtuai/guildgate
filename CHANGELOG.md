# Changelog

All notable changes are recorded here. Semantic Versioning applies from `1.0.0`.

## 1.1.0 - 2026-07-26

### Reliability

- Separated PostgreSQL `COMMIT` from post-commit callback execution. A callback failure no longer emits a false rollback or repeats a committed domain write.
- Added nested PostgreSQL transactions with `SAVEPOINT`, `ROLLBACK TO SAVEPOINT` and callback propagation after successful savepoint release.
- Added reservation ownership to idempotency records. Memory, Redis and PostgreSQL completion/cleanup operations now use compare-and-set semantics.
- Made action deadlines return at the configured boundary even when an operation ignores `AbortSignal`. Late settlement remains observable and idempotent committed results are stored for replay.
- Kept reservation ownership and distributed leases during bounded late settlement. Added `reliability.maximumLateSettlementMs` so an operation that ignores cancellation cannot retain resources without a configured ceiling.
- Added opaque audit cursors ordered by `(createdAt, id)` and store-level pagination for complete traversal.
- Made Redis cache retagging, stale tag removal and cache deletion atomic. Tag indexes now receive bounded TTLs.
- Enforced the per-user session cap inside the official memory, Redis and PostgreSQL stores.
- Serialized PostgreSQL rate-limit bucket updates with transaction-scoped advisory locks.
- Moved configured fail-closed audit persistence into the required transaction before commit.
- Added distributed single-flight locking for Discord OAuth token refresh and re-read credentials after lock acquisition.
- Made cache stampede protection use renewable leases and persist lock-busy fallback loads.

### Realtime

- Routed Socket.IO subscribe, unsubscribe and heartbeat traffic through the same payload-size, rate-limit and activity controls used by WebSocket messages.
- Added Socket.IO acknowledgement responses, replay support and transport backpressure detection.
- Added regression tests for oversized Socket.IO messages, rate limiting, idle activity and slow clients.
- Rechecked subscription capacity after asynchronous authorization, removed failed connections after send errors and isolated revocation listener failures.
- Bounded outbox claim leases, batch size and concurrency; sanitized persisted publisher errors.

### Security

- Cleared expired and revoked session cookies through Fastify, Express and Hono response metadata.
- Rejected IPv4, IPv6, unspecified and IPv4-mapped loopback origins, application URLs and Discord OAuth endpoints in production configuration.
- Added malformed audit cursor validation and reservation-loss errors.
- Extended release verification to require the adapter `1.1` contract, coverage CI and PostgreSQL/Redis service integration CI.

### Testing and operations

- Kept the awaited deadline timer referenced until settlement, preventing Node.js 22 from cancelling pending timeout operations.
- Replaced the idempotency-renewal timing assertion with a controlled execution gate and bounded replay polling instead of relying on one exact timer boundary.
- Serialized native coverage test-file execution with `--test-concurrency=1` so instrumentation does not distort lease-renewal timing.
- Expanded deterministic coverage from 39 tests in 1.0.0 to 76 passing tests in 1.1.0, with two live-service tests enabled in CI.
- Added Node.js test coverage collection with enforced minimums of 80% lines, 70% branches and 70% functions.
- Added disposable PostgreSQL 17 and Redis 8 service tests in GitHub Actions using current client adapters.
- Fixed the ciphertext-tamper regression test to flip a decoded authentication-tag byte instead of mutating Base64URL padding bits.
- Repeated the complete deterministic suite five consecutive times and added 10,000/20,000-operation stress references.
- Updated the load report, migration guide, operating limits, threat model and English/Turkish README files.

## 1.0.0 - 2026-07-26

### Added

- Stable action, store and realtime contracts.
- Guarded writes, realtime transports, PostgreSQL and Redis adapters, operator APIs, monitoring, analytics, charts and telemetry hooks.
- Maintainer security review, external-review handoff, migration policy, operating limits and package verification.

### Security

- Authorized replay, hidden-error handling, SVG output hardening, renewable Redis leases, bounded serialization and secret redaction.
- Runtime bounds for HTTP methods, cookies, OAuth settings, locks, retries and realtime channels.
- Private operator session metadata unless an application supplies an explicit mapper.

## 1.0.0-rc.1 - 2026-07-26

### Added

- Transaction adapters, optimistic revisions, outbox support, renewable leases, WebSocket/Socket.IO/SSE bindings, PostgreSQL stores, Hono and discord.js adapters, telemetry, operator actions and analytics.

## 0.1.1 - 2026-07-26

### Fixed

- Portable CLI help and writing checks from installed package directories.

## 0.1.0 - 2026-07-25

### Added

- Initial storage contracts, sessions, OAuth, guarded actions, Redis stores, HTTP handlers, realtime hub, bilingual errors, documentation and CI.
