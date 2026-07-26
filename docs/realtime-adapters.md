# Realtime adapters

The realtime hub owns session resolution, origin checks, channel authorization, message limits, subscription limits, idle checks and revocation handling. Transport adapters connect the hub to a network library.

## WebSocket

`attachWebSocket()` accepts a socket with `send`, `close`, `on`, optional `ping` and optional `bufferedAmount`. Heartbeat uses ping/pong when the socket supports it. A missing pong closes the connection and detaches it from the hub.

Client messages:

```json
{"type":"subscribe","channel":"guild:123","afterSequence":42}
```

```json
{"type":"unsubscribe","channel":"guild:123"}
```

Each subscription calls the application authorization callback.

## Socket.IO

`attachSocketIo()` uses application-provided handshake auth and origin values. It listens for:

- `guildgate:subscribe`
- `guildgate:unsubscribe`
- `disconnect`

Events are emitted as `guildgate:event`, replay rows as `guildgate:replay` and closure reasons as `guildgate:close`.

## Server-Sent Events

`createServerSentEventStream()` writes valid SSE frames and returns `false` after the buffer limit is exceeded. Applications should authenticate and authorize the HTTP request before creating the stream.

## Sequences and resume

A `RealtimeEventLog` assigns an increasing sequence per channel. Clients store the latest sequence and send it during reconnect. The server replays rows after that cursor up to the configured limit.

Sequence values order events inside one channel. They do not create a global order across channels.

## Revocation across instances

The revocation bus contract lets an application publish a session hash to other instances. Each instance closes matching local connections. A Redis or PostgreSQL notification adapter can implement the bus.

## Outbox workers

`createOutboxWorker()` claims rows with a worker ID and claim lease. A successful publish marks the row complete. A failed publish releases or updates it through the store so another run can retry it.

Configure event retention and replay limits. Realtime logs are not a permanent event archive by default.
