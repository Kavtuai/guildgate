# Architecture

GuildGate separates policy, transport, Discord access, and storage. The core package does not import Fastify, Express, Redis, PostgreSQL, MongoDB, or a WebSocket server.

## Components

1. **Kernel** checks sessions, origins, CSRF tokens, blocks, maintenance state, limits, authorization, idempotency, locks, deadlines, audit records, cache tags, and realtime delivery.
2. **Session manager** stores only a SHA-256 hash of the opaque session token. Expiry, idle expiry, rotation, caps, and revocation are enforced at resolution time.
3. **Discord OAuth client** creates one-time state records, binds state to a browser nonce, exchanges codes, encrypts credentials, refreshes access tokens, and revokes credentials.
4. **Discord authorizer** compares the user’s OAuth guild permissions with the bot’s current guild roles and permissions.
5. **Store interfaces** allow each application to select storage. Durable and short-lived records can use different services.
6. **Framework adapters** translate request and response objects without placing framework types in the core package.
7. **Realtime hub** authenticates connections, authorizes each subscription, limits messages, handles slow clients, and closes sessions on revocation.
8. **Outbox dispatcher** publishes committed events from a durable outbox implementation.

The component diagram is in [`uml/components.mmd`](./uml/components.mmd).

## Action order

The default order for an unsafe authenticated request is:

1. Resolve and, when due, rotate the session.
2. Check the exact request origin.
3. Validate the CSRF token against the session hash.
4. Parse input.
5. Resolve the protected resource.
6. Apply maintenance and block policies.
7. Apply the action rate limit.
8. Run application or Discord authorization.
9. Reserve the idempotency key.
10. Acquire the resource lock.
11. Run the operation under one deadline.
12. Complete the idempotency record before non-transactional follow-up work.
13. Invalidate cache tags.
14. Enqueue or publish realtime events.
15. Write the audit event.
16. Release the lock.

See [`uml/action-sequence.mmd`](./uml/action-sequence.mmd).

## Transaction boundary

GuildGate cannot create a transaction for an unknown database driver. The action’s `execute()` function owns the database transaction.

For a setting write, the application should place these changes in one transaction where possible:

- Read or compare the current revision.
- Write the new setting record.
- Write the application’s domain audit record if it must be atomic with the setting.
- Write a durable outbox row.

GuildGate’s general audit store runs after `execute()`. Use `audit.failClosedActions` only when refusing the response after an audit failure is useful. It cannot undo a transaction that has already committed. A high-risk operation that requires atomic audit must write its domain audit inside `execute()`.

## Consistency choices

- **Session and OAuth state:** consistent, single-use, fail closed.
- **Idempotency and distributed locks:** atomic store operations are required for multiple instances.
- **Guild display data:** short cache duration is acceptable.
- **Permission-sensitive writes:** use live Discord checks or a bot gateway cache that is invalidated by member and role events.
- **Audit and outbox:** durable storage is recommended.
- **Realtime delivery:** an event may be delivered after commit. Use an outbox when delivery must survive process restarts.

## Failure policy

The kernel fails closed when it cannot establish authentication, CSRF validity, origin validity, a block policy, a required rate limit, authorization, idempotency ownership, or a resource lock.

The application chooses what to do when cache, audit, or realtime delivery fails. Current action behavior is:

- Cache invalidation, realtime publication, and outbox enqueue failures are returned as `meta.postCommitIssues`; the committed operation is not repeated.
- General audit failure is also reported as a post-commit issue. It fails the response only when the action name is in `audit.failClosedActions`.
- An audit fail-closed action must use idempotency so a client retry cannot repeat an operation that may already be committed.

A production adapter can add retries, queues, or driver-specific handling around these interfaces.

## Trust boundaries

- The browser is untrusted.
- Route parameters, body fields, headers, locale values, and channel names are untrusted.
- OAuth access does not grant bot permissions.
- A cached guild list is not permanent authorization.
- A reverse proxy header is trusted only when the application has configured the proxy chain.
- Store implementations are trusted code and must preserve atomic semantics stated by their interfaces.
- Realtime transport libraries are responsible for TLS termination and frame parsing. The GuildGate hub starts after the transport accepts a connection.
