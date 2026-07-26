# Operating limits

GuildGate enforces bounded request, action, session and realtime behavior. The application remains responsible for selecting limits that fit its database, Discord request budget and infrastructure.

## Deadlines

An action deadline is a response boundary. GuildGate returns `UPSTREAM_TIMEOUT` at that boundary even when application code ignores `AbortSignal`.

- The supplied signal should be forwarded to database, HTTP and queue clients that support cancellation.
- JavaScript cannot forcibly terminate an arbitrary promise. A late operation may still settle after the caller receives `504`.
- For an idempotent action, GuildGate keeps the reservation and distributed lease during the bounded settlement window, then stores a committed result for replay or releases a failed reservation.
- `reliability.maximumLateSettlementMs` bounds that window. Reaching the bound releases ownership even when the application promise is still running.
- The idempotency TTL must be longer than the action timeout and long enough to cover expected late settlement.
- Non-idempotent external side effects should not be placed behind automatic retry.

## Transaction finality

A successful database commit is final. Cache invalidation, audit, realtime delivery and observer callbacks run after or alongside the commit according to the configured adapter.

- A post-commit failure is reported as a post-commit issue.
- A fail-closed audit action writes audit before commit and requires the audit store to enlist in the same transaction.
- It does not trigger rollback and must not cause the domain function to run again.
- Nested PostgreSQL work uses savepoints; an inner rollback does not roll back the outer scope unless the error is allowed to escape.

## Idempotency

Reservation IDs prevent stale workers from completing or deleting records owned by a newer request.

- `begin()` must create a new owner token with the inflight record.
- `complete()` and `fail()` must compare the token atomically.
- Completed responses should remain available for the configured TTL.
- A consumer should use a key scoped to the authenticated actor, action and intended resource.

## Distributed locks

A lease limits overlapping work; a fencing token protects the durable write after a lease expires.

- Renewal failures abort the action signal. Cache stampede protection also uses a renewable lease when the store exposes renewal.
- The durable store should reject a lower fencing token.
- A lock without a fence cannot stop an expired worker that reaches the database late.
- Lock TTL must exceed ordinary work duration, and renewal cadence must leave room for temporary network delay.

## Sessions

Official memory, Redis and PostgreSQL stores enforce `maximumSessionsPerUser` in the store operation.

- Expired and revoked sessions are deleted when resolved.
- HTTP adapters clear the session cookie on expiry or revocation.
- Shared custom stores should implement atomic create-and-evict behavior.
- Redis user-session indexes receive TTLs and remove missing session members during listing.

## Realtime

WebSocket and Socket.IO traffic share message-size, rate, channel, subscription, idle and backpressure controls.

- `maximumMessageBytes` is measured on the serialized client message.
- Slow clients are disconnected when the buffered-byte boundary is exceeded.
- Session validity is rechecked periodically and may also be revoked through the revocation bus.
- Reconnect and replay use a channel sequence cursor.

## Outbox delivery

The transactional outbox is at-least-once.

- Workers can claim rows with a lease and `SKIP LOCKED` semantics.
- A worker crash may cause the same event to be delivered again after the claim expires.
- Consumers must deduplicate by event ID before applying an external side effect.
- Batch size is capped at 5,000, dispatch concurrency at 64 and claim leases between one second and 24 hours.
- Stored publisher errors are newline-normalized and limited to 2,048 characters.
- Retention should remove published rows after the application’s replay and incident window.

## Cache and audit

Redis cache tag maintenance is atomic and tag indexes receive TTLs. Audit paging uses an opaque cursor based on `(createdAt, id)` so equal timestamps remain stable. Applications should retain audit records according to policy and index their most common actor/action filters.

## Capacity testing

`npm run test:load` is an in-memory regression harness, not a production capacity statement. Use it to compare code changes on similar machines. Production sizing must include the selected PostgreSQL, Redis, network, Discord API and telemetry paths.
