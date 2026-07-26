# Stable adapter contracts

GuildGate keeps optional ecosystems behind compatibility interfaces.

```ts
adapterContractVersion = "1.1"
actionContractVersion = "1.0"
realtimeContractVersion = "1.0"
```

## Store contract 1.1

A `GuildGateStores` implementation supplies sessions, OAuth state, credentials, rate limits, cache, idempotency, locks, audit, outbox and policies. `runStoreContract()` checks the core invariants.

Contract 1.1 adds these shared-store requirements:

- idempotency renewal, completion and cleanup compare a reservation ID
- `SessionStore.create()` can insert and enforce the user session cap atomically
- `AuditStore.listPage()` applies an opaque cursor in the backing query
- cache retagging must not leave stale membership that can delete a newer entry
- rate-limit decisions and policy-version increments remain atomic across instances

A custom adapter should run the contract against a clean namespace in CI. The contract does not replace replication, failover, backup or retention testing.

## Transaction contract

A transaction adapter must:

- commit only after work resolves
- roll back only before a successful commit
- call post-commit callbacks after finality
- never convert a post-commit callback failure into rollback
- use savepoints or document the absence of nested transaction support
- keep one raw backend context for store calls inside the scope

## Framework contract

HTTP handlers translate a request into `RequestEnvelope` and `ActionResult` back into HTTP. They must carry replacement and clearing cookies, request IDs, rate headers and post-commit issue metadata. The framework remains responsible for route registration, body limits, proxy trust and TLS.

## Realtime contract

A transport supplies send, close and buffered-byte state. Client subscribe, unsubscribe and heartbeat messages pass through `hub.acceptMessage()` before transport-specific handling. The hub controls authorization, message size, rate, activity, subscription limits and session revalidation.

## Compatibility testing

Before publishing an adapter:

1. compile against the oldest supported declarations
2. run `runStoreContract()`
3. test stale reservation ownership and atomic session limits
4. test cancellation, response deadlines and late settlement
5. test two concurrent processes when shared work is claimed
6. document consistency, TTL and failure behavior
