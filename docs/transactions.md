# Reliable write model

GuildGate separates request safety from database ownership. The application chooses the database and supplies a transaction adapter when atomic behavior is required.

## Execution order

A guarded write can apply session/origin/CSRF checks, parsing, owner policy, authorization, idempotency reservation, optimistic revision validation, a distributed lease, transaction work, outbox enqueue, commit, cache invalidation, audit and realtime delivery.

The important boundary is commit. Work required for domain correctness belongs inside the transaction. Cache, telemetry and immediate realtime delivery are observers unless the application writes them through the same transaction.

## Commit finality

A successful `COMMIT` is never followed by rollback behavior. `afterCommit` callbacks run after finality. When one fails:

- rollback callbacks do not run
- the domain function is not repeated
- the adapter reports the error through `onPostCommitError` or `TransactionPostCommitError`
- the kernel exposes a post-commit issue for operations staff

Mandatory audit or delivery records should be inserted as transaction rows. A configured fail-closed audit action writes audit before commit and requires its audit store to enlist in the same transaction. Durable delivery normally uses the outbox.

## Nested PostgreSQL work

The PostgreSQL adapter uses `SAVEPOINT` for a nested transaction. A nested failure rolls back to that savepoint and runs only its rollback callbacks. Successful nested commit callbacks are appended to the parent and run after the outer `COMMIT`.

A nested scope cannot change isolation or read-only mode because PostgreSQL applies those properties to the outer transaction.

## Optimistic revisions

The client sends an expected revision and the action reads the trusted current revision. The database update should also compare the revision:

```sql
UPDATE guild_settings
SET prefix = $1, revision = revision + 1
WHERE guild_id = $2 AND revision = $3
RETURNING revision;
```

Zero rows means another writer won.

## Idempotency ownership

An inflight record includes a reservation ID. The same key can be reclaimed after expiry, but an older worker cannot complete or delete the replacement record because `complete()` and `fail()` compare the reservation ID atomically.

## Deadlines and late settlement

A deadline controls when the request receives a response. GuildGate returns a timeout at the configured boundary even if the operation ignores `AbortSignal`. The underlying settlement remains observable.

For an idempotent action, GuildGate keeps the reservation and lease while the bounded late-settlement observer is active. A late committed result is stored for replay; a late failure releases only the reservation still owned by that execution. `reliability.maximumLateSettlementMs` ends observation and releases ownership at the configured ceiling. Application code should forward the signal to clients that support cancellation and enforce fencing at the durable write boundary.

## Leases and fencing

A renewable lease limits concurrent work. A monotonically increasing fencing token protects the durable write after a lease expires. The database should reject a token lower than the last accepted token.

## Outbox

Outbox delivery is at-least-once. A worker can publish successfully and crash before recording completion. Consumers must deduplicate by event ID.
