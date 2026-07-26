# Reliable write model

GuildGate separates request safety from database ownership. The application chooses the database and supplies a transaction adapter when atomic behavior is required.

## Execution order

A guarded write can apply:

1. session, origin and CSRF checks
2. parsing and resource resolution
3. owner policy, block and rate checks
4. application or Discord authorization
5. idempotency reservation
6. optimistic revision validation
7. distributed lease acquisition
8. transaction start
9. retry attempt and action execution
10. transactional outbox enqueue
11. commit hooks
12. cache invalidation and general audit handling

## Optimistic revisions

The client sends an expected revision. The action reads the current revision from trusted storage. A mismatch returns `REVISION_CONFLICT` before the domain update.

The database update should still include the revision in its `WHERE` clause. This closes the race between reading and writing:

```sql
UPDATE guild_settings
SET prefix = $1, revision = revision + 1
WHERE guild_id = $2 AND revision = $3
RETURNING revision;
```

Zero rows means another writer won.

## Transactions and hooks

A transaction adapter receives isolation, read-only and timeout options. Hooks can run:

- before the transaction work
- before commit
- after commit
- after rollback

An `afterCommit` hook must not contain work required for database correctness. Put mandatory domain records and outbox rows in the transaction.

## Retries

Retry only failures known to be safe for the current operation. Idempotency protects repeated external requests, but a database retry also needs a transaction that fully rolls back the failed attempt.

## Leases and fencing

A renewable lease limits concurrent work. A fencing token increases each time a new owner acquires a key. Durable writes should reject a token older than the last accepted token. This prevents a paused process from committing after its lease has expired.

## Cache and audit after commit

Cache invalidation and the general audit store may fail after the domain commit. GuildGate reports these failures in `meta.postCommitIssues` rather than repeating the domain operation. Mandatory audit records belong in the application transaction.
