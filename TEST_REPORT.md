# Test report

Date: 2026-07-25  
Package: `@kavtuai/guildgate@0.1.0`

## Local toolchain

- Node.js: 22.16.0
- npm: 10.9.2
- TypeScript compiler: 5.8.3

## Passed checks

- Strict TypeScript build.
- Type-only check without emit.
- Repository writing check.
- npm package dry-run.
- Local offline installation of the generated `.tgz` package into an empty consumer project.
- Import checks for every public package subpath.
- Production doctor check with generated test secrets and HTTPS test URLs.
- Public declaration scan for accidental `Buffer` or Node namespace requirements.
- Model citation artifact and unfinished placeholder scan.

## Automated behavior tests

Eleven tests pass:

1. Protected actions reject missing sessions and missing CSRF tokens.
2. Idempotency replays the first result and rejects changed payloads.
3. Rate limits and owner maintenance policy are applied.
4. Cache tags invalidate matching entries.
5. A cache failure after commit does not repeat the domain operation.
6. Error messages remain in the selected locale and support application overrides.
7. Discord high-bit permissions retain precision with `BigInt`.
8. Base guild permissions combine the everyone role and member roles.
9. Discord OAuth state is browser-bound, single-use, encrypted at rest, and rejects external return URLs.
10. Realtime subscriptions require authorization and explicit session revocation closes sockets.
11. Periodic realtime session validation closes a socket revoked outside the hub.

## Not run in this container

- A real Discord OAuth callback.
- A real Discord bot permission request.
- A real Redis server.
- PostgreSQL, MongoDB, MySQL, or SQLite integration.
- Fastify and Express example installation with their external framework dependencies.
- Dependency installation from the npm registry. Registry access from the build container timed out, so this archive does not contain a generated `package-lock.json`.
- External security review and load test.

These tests must be completed in the target repository before a production `1.0.0` release. The package name and GitHub repository name were not published or reserved by this build.
