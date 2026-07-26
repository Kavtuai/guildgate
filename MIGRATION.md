# Migration policy

## Versioning

GuildGate follows Semantic Versioning from `1.0.0`.

- Patch releases correct behavior without intentionally changing public contracts.
- Minor releases may add optional fields, exports and adapter capabilities.
- Major releases may remove or change public contracts after documented migration guidance.

## Stable contract markers

The package exports `adapterContractVersion`, `actionContractVersion` and `realtimeContractVersion`.

- adapter contract: `1.1`
- action contract: `1.0`
- realtime contract: `1.0`

Custom stores should record the contract they implement and run `runStoreContract()` in CI.

## From 1.0.0 to 1.1.0

### Idempotency ownership

`IdempotencyRecord` now carries `reservationId`. A custom idempotency store must treat this value as the owner token for an inflight record.

```ts
const started = await store.begin({
  key,
  requestHash,
  reservationId,
  state: "inflight",
  createdAtMs: Date.now(),
  expiresAtMs,
});

const completed = await store.complete(
  key,
  response,
  expiresAtMs,
  reservationId,
);
```

`renew()`, `complete()` and `fail()` return `false` when the reservation no longer owns the record. Do not extend, update or delete by key alone. PostgreSQL should include `reservationId` and `state='inflight'` in the predicate; Redis should use an atomic Lua compare-and-set operation.

### Atomic session caps

`SessionStore.create(record, maximumSessionsPerUser)` is optional for compatibility and strongly recommended for shared stores. Official stores insert the session and evict excess sessions in one serialized store operation. A custom multi-instance store should implement the same invariant rather than relying on `listByUser()` followed by separate deletes.

### Cursor-based audit paging

`AuditStore.listPage()` accepts an opaque cursor and returns `{ items, nextCursor }`. The stable ordering is `createdAt DESC, id DESC`. Decode and apply the cursor in the database query; do not fetch a small first page and paginate that array in memory.

### Transaction finality

A transaction adapter must issue rollback callbacks only when work or commit fails before a successful commit. `afterCommit` failures happen after finality and must not cause `ROLLBACK` or repeat the domain operation. Use `TransactionOptions.onPostCommitError` to report an observer failure while preserving the committed result.

Nested PostgreSQL transactions use savepoints. A nested transaction may not change isolation or read-only mode. Its `afterCommit` callbacks join the parent only after savepoint release; its rollback callbacks run when the nested scope rolls back.

### Deadlines and late settlement

`runWithDeadline()` now returns a timeout at the configured boundary. The thrown `DeadlineExceededError` exposes a `settlement` promise for the underlying operation. GuildGate uses this to finalize an idempotent write that commits after the HTTP response has timed out.

Application code should still honor the supplied `AbortSignal` when the physical operation must stop early. `reliability.maximumLateSettlementMs` bounds how long the kernel retains reservation and lease ownership after the response deadline. For an idempotent action, configure an idempotency TTL longer than its deadline and keep external writes idempotent. Durable writes that can outlive a lease should reject stale fencing tokens.


### Fail-closed audit and PostgreSQL rate limits

An action listed in `audit.failClosedActions` must enable audit, idempotency and a required transaction. The audit store must enlist in the same transaction as the domain write; otherwise the application cannot claim atomic fail-closed audit behavior.

The official PostgreSQL rate-limit store now serializes each bucket through a transaction-scoped advisory lock. Custom SQL stores should use an equivalent atomic counter or serialized read/update path, including the first insert.

### Discord OAuth refresh

Refresh now uses the configured distributed lock store as a single-flight lease. The credential record is read again after lock acquisition so a waiting caller can reuse a token already refreshed by another instance. Custom lock stores should support renewal for long network calls.

### Redis cache tags

A custom Redis cache adapter should update the cache entry and tag memberships atomically. When an entry changes from tag `old` to `new`, remove the key from `old`, add it to `new`, and preserve a tag-index TTL at least as long as the entry TTL.

### Realtime transports

Socket.IO client events now pass through the same hub controls as WebSocket messages. Custom transports should call `hub.acceptMessage()` before subscribe, unsubscribe or heartbeat handling. Slow-client detection must surface the transport write state through `bufferedAmount` or an equivalent value.

## Upgrade sequence

1. Read the changelog and this file.
2. Install the target version in a branch.
3. Run `npm run typecheck`, the application tests and `npm run test:coverage`.
4. Run `runStoreContract()` against every custom store.
5. Print and review PostgreSQL migration SQL before execution.
6. Run login, guarded write, timeout, session revocation, permission loss and realtime reconnect tests.
7. Deploy one instance first when changing durable adapters.
8. Watch audit, outbox, post-commit, reservation-loss, rate and error metrics before completing rollout.

## From 0.1.1 to 1.0.0

The first stable line added optimistic checks, transactions, renewable leases, realtime delivery, PostgreSQL, operator APIs and stable error handling. Hidden server errors stopped exposing internal details, generic `TypeError` values stopped retrying by default and operator session metadata became private unless explicitly mapped.

## Deprecation policy

A public contract scheduled for removal normally remains available for at least one minor release. A direct security risk may require a shorter period and will be documented in the advisory and changelog.

## Rollback

Code rollback does not imply schema rollback. Before a migration, take a tested backup, verify whether old code can read the new schema and delay destructive changes until the compatibility period ends.
