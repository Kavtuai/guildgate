# Realtime adapters

The realtime hub owns session validation, exact-origin checks, channel authorization, message size, client rate, idle activity, subscription limits and slow-client handling. The transport binds those controls to a network library.

## WebSocket

`attachWebSocket()` supports ping/pong heartbeat, authorized subscribe/unsubscribe messages and replay from a channel sequence. Invalid JSON, oversized messages, rate excess and slow clients close with an appropriate protocol code.

## Socket.IO

`attachSocketIo()` reads the session and origin from the handshake or explicit input. Subscribe, unsubscribe and heartbeat events are serialized and passed through `hub.acceptMessage()`, so they share WebSocket payload, rate and activity controls.

Acknowledgements return `{ ok, channel }` or a stable error code. Replay uses `guildgate:replay`. A transport whose writable flag is false exposes infinite buffered pressure and is disconnected by the hub.

## Server-Sent Events

`createServerSentEventStream()` formats SSE frames and maintains a bounded queue. The stream closes when the queue limit is exceeded. Authenticate and authorize the HTTP request before opening it.

## Resume and delivery

Sequences are ordered within one channel, not globally. A reconnecting client sends its last sequence and the event log returns a bounded replay. The transactional outbox is at-least-once; client and worker consumers should deduplicate by event ID.

## Revocation

The local hub closes connections immediately for a revoked session. Multi-instance deployments should publish session hashes through the revocation bus so every instance closes matching connections. Periodic session revalidation is a second line of defense.

## Failure and race handling

Subscription capacity is checked again after asynchronous authorization completes. A send failure closes and removes the broken connection. Session revocation listeners are isolated so one synchronous or asynchronous listener failure does not prevent other local nodes from processing the revocation message. Outbox dispatch bounds batch size, claim lease and concurrency, and sanitizes stored error text.
