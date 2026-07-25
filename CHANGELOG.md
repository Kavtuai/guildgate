# Changelog

All notable changes are recorded in this file. The project follows Semantic Versioning after `1.0.0`. Before `1.0.0`, a minor release may contain an API change with migration notes.

## 0.1.0 - 2026-07-25

### Added

- Database-neutral storage contracts.
- Memory reference stores.
- Redis stores for sessions, OAuth state, rate limits, cache, idempotency, and locks.
- Opaque sessions with expiry, idle expiry, rotation, caps, and revocation.
- Discord OAuth authorization-code client with state and browser nonce binding.
- AES-256-GCM credential keyring.
- Discord `BigInt` permission helpers and guild access authorizer.
- Guarded actions with parsing, policies, limits, authorization, idempotency, locks, deadlines, audit, cache tags, and realtime delivery.
- Fastify and Express adapters.
- Realtime hub and outbox dispatcher.
- English and Turkish error messages and documentation.
- UML, threat model, store guide, writing guide, CI, trusted publishing workflow, doctor command, and tests.
