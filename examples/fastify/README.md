# Fastify example

This example uses the memory store and a development login route. It is intended for local API testing only.

```bash
cd examples/fastify
npm install
npm run dev
```

1. Send `POST /dev/login` and retain the returned cookie and CSRF token.
2. Send `PATCH /api/guild-settings` with `Origin: http://localhost:3000`, `X-CSRF-Token`, `Idempotency-Key`, and this body:

```json
{
  "guildId": "123",
  "revision": 0,
  "locale": "en"
}
```

Replace the memory store, development login, and map-backed setting record before using the code in a deployed application.
