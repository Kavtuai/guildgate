# Custom storage drivers

GuildGate does not select a database. Implement `GuildGateStores` and pass it to `createGuildGate()`.

## Suggested placement

| Record | Typical storage | Required property |
|---|---|---|
| Sessions | Redis or durable database | atomic create-and-cap, revocation |
| OAuth state | Redis or database | single-use consume |
| OAuth credentials | durable database | encrypted persistence |
| Rate limits | Redis or atomic counter store | atomic window decision |
| Cache | Redis or application cache | atomic tag maintenance |
| Idempotency | Redis or durable database | first-writer reservation and owner CAS |
| Locks | Redis, advisory lock or lease service | token-safe release and renewal |
| Audit | append-oriented database | stable cursor query |
| Outbox | same database as domain write | transaction and claim ownership |
| Policies | durable database | atomic version bump |

## SessionStore

The core stores only `idHash`, never the raw token. `create(record, maximumSessionsPerUser)` should insert the record and evict excess sessions in one serialized operation. `set()` remains available for compatibility and record rotation.

## OAuthStateStore

`consume(stateHash, nowIso)` must read and delete atomically. Two callbacks must not consume the same state.

## RateLimitStore

`hit()` atomically decides whether the cost fits in the current window. A separate read and write is not safe across processes.

## CacheStore

`set()` should update the entry and its tag memberships atomically. Retagging must remove stale memberships. Tag indexes need TTLs so expired cache keys do not leave permanent index rows. `deleteByTags()` should verify that a current entry still carries the requested tag before deleting it.

## IdempotencyStore

`begin()` is first-writer ownership. An inflight record includes `reservationId`.

- no record: store inflight and return `started`
- same hash and inflight: return `inflight`
- same hash and completed: return the stored response
- different hash: return `conflict`

`renew()`, `complete()` and `fail()` must compare `reservationId` and inflight state atomically. They return `false` for a stale owner. Renewal extends only the currently owned inflight record and should preserve its request hash and creation time.

## LockStore

Release must compare the token. Long work should implement renewable leases and increasing fencing tokens. Durable writes should compare the fence when an expired worker can still reach the database.

## AuditStore

`listPage()` orders by `createdAt DESC, id DESC` and applies the opaque cursor in the backing query. Prefer append-only permissions for the application role.

## OutboxStore

Multiple workers need row claiming, skip-locked behavior or another lease. Delivery is at-least-once and `markPublished()` should be idempotent. Consumers deduplicate by event ID. Clamp caller-provided batch, concurrency and claim-lease settings before using them in queries or worker creation.

## Contract tests

Run `runStoreContract()` against a clean namespace. Add service tests for concurrency, expiry and backend-specific scripts. The official CI exercises the public PostgreSQL and Redis adapters against disposable services.
