# Custom storage drivers

GuildGate does not select a database. Implement the interfaces in `GuildGateStores` and pass them to `createGuildGate()`.

## Record placement

A common production layout is:

| Record | Suggested storage | Reason |
|---|---|---|
| Sessions | Redis or a database with expiry cleanup | Fast lookup and revocation |
| OAuth state | Redis or an atomic database record | Single-use consume operation |
| OAuth credentials | Durable database | Encrypted refresh tokens must survive restarts |
| Rate limits | Redis or another atomic counter store | Shared limits across instances |
| Cache | Redis or application cache | Shared invalidation |
| Idempotency | Redis or durable database | Atomic first-writer ownership |
| Locks | Redis, database advisory locks, or lease service | Shared resource exclusion |
| Audit | Durable append-oriented database | Search, retention, incident review |
| Outbox | Same database as the domain write when possible | Commit and delivery coordination |
| Policies | Durable database | Maintenance and block state survives restart |

This is a deployment suggestion, not a package requirement.

## Required semantics

### SessionStore

`set()` must replace the complete record. `listByUser()` must return active and revoked records still present in storage. The session manager removes expired records and enforces the per-user cap.

Do not store the raw session token. The core sends only `idHash` to the store.

### OAuthStateStore

`consume(stateHash, nowIso)` must read and delete in one atomic operation. Two callbacks using the same state must not both succeed.

### OAuthCredentialStore

Store only ciphertext produced by `TokenCipher`. Restrict direct database access because a stolen encryption key and copied ciphertext together expose Discord credentials.

### RateLimitStore

`hit()` must atomically decide whether the cost fits within the current window. It returns the limit, remaining count, reset time, and retry delay.

A read followed by a write without a transaction is not sufficient for multiple instances.

### CacheStore

`deleteByTags()` must delete entries matching any requested tag. It may return an approximate count if the backing cache expires index entries independently, but it must not leave known matching entries intentionally.

### IdempotencyStore

`begin()` is a first-writer operation:

- No record: write `inflight` and return `started`.
- Same key and same request hash, still inflight: return `inflight`.
- Same key and same request hash, completed: return the stored response.
- Same key and different request hash: return `conflict`.

`complete()` must preserve the original request hash and store the result. `fail()` removes an abandoned reservation so a later retry can run.

### LockStore

`acquire()` writes a lease only when no valid lease exists. `release()` must compare the token before deleting the lease. Deleting a lock by key alone can release a newer owner’s lock.

Long operations should renew leases or use a driver whose transaction lock lasts for the operation. GuildGate 0.1.0 does not include lease renewal.

### AuditStore

Prefer append-only permissions for the application account. Redaction in the kernel covers known secret field names, but applications should avoid sending secrets in `changes` at all.

### OutboxStore

`next()` returns unpublished rows. Multiple workers need row claiming, skip-locked reads, or another lease mechanism in the custom driver. `markPublished()` must be idempotent.

### PolicyStore

Block lookup must ignore or remove expired blocks. `bumpPolicyVersion()` must be atomic. The version is written into audit events so an operator can see which policy generation handled a request.

## Driver package layout

A separate adapter can be published without changing the core package:

```text
packages/
  guildgate-postgres/
    src/
      sessions.ts
      credentials.ts
      audit.ts
      outbox.ts
      policies.ts
      index.ts
```

Use peer dependencies for the ORM or database client when the adapter should share the application’s installed client.

## Driver contract tests

Run the same behavior tests against every adapter:

- OAuth state can be consumed once under concurrency.
- A session can be revoked immediately.
- Rate costs never exceed the limit under parallel requests.
- One idempotency key has one owner.
- A changed payload causes a conflict.
- A lock cannot be released by another token.
- Tag invalidation removes all matching cache entries.
- Two outbox workers do not publish one row twice without an idempotent publisher.
- Expired blocks stop applying.

The repository’s memory driver is a reference for behavior, not for production durability.
