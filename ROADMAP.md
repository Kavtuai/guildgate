# Roadmap

GuildGate develops around public capabilities rather than broad promises. Version `1.1.0` completes the first reliability-hardening cycle for the stable contract line.

## Completed in 1.1.0

### Transaction and deadline correctness

- final commit separated from post-commit observers
- nested PostgreSQL savepoints
- late-settlement tracking after a strict response deadline
- bounded lease and reservation retention during late settlement
- committed idempotent result replay after timeout
- transactional fail-closed audit persistence

### Ownership and shared-store invariants

- reservation-token compare-and-set idempotency
- atomic session caps in memory, Redis and PostgreSQL
- atomic Redis cache retagging and tag-index TTLs
- opaque audit cursor pagination
- serialized PostgreSQL rate-limit bucket updates
- distributed OAuth refresh single-flight

### Realtime parity

- shared WebSocket and Socket.IO payload/rate/activity controls
- Socket.IO acknowledgements and replay
- slow-client detection and session revalidation
- authorization-race capacity checks and failed-connection cleanup
- isolated session revocation listeners

### Verification

- 76 deterministic tests
- PostgreSQL and Redis live-service integration tests in CI
- Node.js coverage collection with release-blocking thresholds
- CodeQL, package verification, secret scanning and load regression
- English and Turkish migration and operations guidance

## Stable maintenance line

The next releases focus on compatibility and evidence:

- database migration compatibility tests across supported PostgreSQL majors
- Redis client compatibility matrix
- richer OpenTelemetry semantic conventions
- fault-injection tests for network partitions and worker termination
- signed release evidence and reproducible package metadata
- independent external security review when a reviewer is commissioned

## Not planned for the core package

GuildGate will not become a dashboard UI framework, Discord command framework or application database owner. UI components, product-specific authorization and domain schemas remain in the consuming application.
