# Threat model

## Protected assets

Discord bot and OAuth credentials, session records, guild settings, audit history, owner policies, realtime events, operational analytics and package publication integrity are protected assets.

## Considered attacks

The model covers unauthenticated requests, CSRF, cross-site socket connections, OAuth replay, duplicate writes, stale revisions, stale idempotency workers, expired lock owners, slow realtime clients, secret leakage, low-privilege database access and publication-chain compromise.

## Controls

- opaque HttpOnly session cookies and server-side token hashes
- rotation, expiry, idle expiry, revocation and atomic session caps
- exact-origin and session-bound CSRF checks
- one-time browser-bound OAuth state
- server-side resource and Discord authorization
- reservation-owned idempotency and optimistic revisions
- renewable leases and fencing tokens
- strict response deadlines, bounded retry and circuit breakers
- transaction finality and savepoint handling
- channel authorization, message/rate limits, backpressure and session revalidation
- transactional outbox with claim leases
- audit redaction, bounded serialization and owner action controls
- protected GitHub environment, OIDC npm publication and provenance

## Important invariants

A committed write is not rolled back because an observer fails. An old idempotency worker cannot complete a newer reservation. An expired lease owner cannot be trusted without a durable fencing comparison. An outbox event may be delivered more than once and must be deduplicated by ID.

## Boundaries

GuildGate cannot secure a compromised host, incorrect TLS or firewall configuration, over-privileged database roles, leaked application secrets or product-specific authorization rules. Reverse-proxy trust and Discord policy remain application responsibilities.

The included review is a maintainer review, not an independent third-party audit. `EXTERNAL_REVIEW_GUIDE.md` defines the handoff for a commissioned review.
