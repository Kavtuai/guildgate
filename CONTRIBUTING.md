# Contributing

## Before opening a change

- Check existing issues and release plans.
- Keep the core free of framework and database runtime dependencies.
- Add or update tests for behavior changes.
- Update English and Turkish user-facing messages separately.
- Update UML or architecture notes when a trust boundary or action order changes.
- Do not add secrets, copied production data, or generated dependency folders.

## Local checks

```bash
npm install
npm run typecheck
npm test
npm run pack:check
```

## Pull requests

Describe the problem, the changed contract, failure behavior, tests, and migration needs. Security-sensitive changes should state:

- What input is untrusted.
- Which store operation must be atomic.
- Whether the behavior fails open or closed.
- What is written to audit logs.
- Whether a session, cache, policy, or socket must be invalidated.

Follow `docs/WRITING_STYLE.md` for repository text.
