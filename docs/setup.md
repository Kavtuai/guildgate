# Setup, consumer validation and release

## Install the source archive

```bash
unzip GuildGate-1.1.0-kavtuai.zip
cd guildgate-1.1.0
npm ci
npm run release:verify
```

Use Node.js 22 or newer. Keep `package-lock.json` committed so CI and contributors use the same development dependency graph.

## Application installation

A consumer application installs a published version from npm:

```bash
npm install @kavtuai/guildgate
```

For release-candidate testing, install the exact tag or version chosen by the maintainer. Application runtime dependencies such as Fastify, Hono, PostgreSQL clients, Redis clients, `ws` and discord.js remain application-owned.

## Environment validation

Copy `.env.example` into a private environment file and use separate random values for every secret.

```bash
node ./bin/guildgate-doctor.mjs
```

Set `GUILDGATE_ENVIRONMENT=production` for the deployment check. Production mode checks HTTPS, allowed origins, secret lengths and the token-encryption key format.

## Select storage

Choose one of these patterns:

- memory stores for tests and single-process development
- Redis stores for short-lived shared records
- the built-in PostgreSQL adapter for durable records, transactions, analytics, realtime sequences and outbox claims
- custom stores that pass `runStoreContract()`

Print PostgreSQL SQL before applying it:

```bash
npx guildgate-migration --prefix guildgate > guildgate.sql
```

Run schema changes through the application migration system rather than from every process at startup.

## Consumer package check

Create a separate empty directory:

```bash
mkdir guildgate-consumer-test
cd guildgate-consumer-test
npm init -y
npm install /path/to/kavtuai-guildgate-1.1.0.tgz
node -e "import('@kavtuai/guildgate').then(m => console.log(typeof m.createGuildGate))"
npx guildgate-doctor --help
npx guildgate-migration --help
```

The import should print `function` and both commands should exit successfully.

## Application integration order

1. Select stores and transaction ownership.
2. Configure the kernel and run the doctor command.
3. Add Discord OAuth start and callback routes.
4. Return the session-bound CSRF token through an authenticated bootstrap endpoint.
5. Add one read action and one idempotent write action.
6. Add live user and bot guild authorization to protected actions.
7. Add optimistic revision checks where two editors can change the same record.
8. Use a transaction adapter for domain writes and outbox rows that must commit together.
9. Add audit, outbox, analytics and realtime retention jobs.
10. Connect WebSocket, Socket.IO or SSE after HTTP authorization works.
11. Expose operator actions only behind explicit owner authorization.
12. Test role removal, bot removal, session revocation, Redis loss, database timeout, duplicate writes and reconnect cursors.

## Repository and npm release

Protect `main`, require CI and CodeQL checks, and publish through a GitHub release. The included workflow uses npm Trusted Publisher/OIDC and the `npm` environment. Keep direct workstation publishing disabled after that trust relationship is configured.

Before a release:

```bash
npm run release:verify
npm pack --json
```

The release tag must equal `v` plus the `package.json` version. Version `1.1.0` must pass `npm run release:verify`; the maintainer audit is recorded in `SECURITY_AUDIT.md`.
