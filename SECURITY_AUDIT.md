# Maintainer security audit

Date: 2026-07-26
Reviewed version: `@kavtuai/guildgate@1.0.0`

## Scope

This review covers the package source, public exports, HTTP adapters, session and OAuth handling, guarded writes, retry and lock behavior, realtime replay, Redis and PostgreSQL adapters, operator responses, analytics SVG output, release automation and package contents.

The review was performed by the project maintainer. It is a release security review, not an independent third-party audit. GuildGate does not describe `1.0.0` as externally audited.

## Method

The review combined:

- manual data-flow review from untrusted input to storage, logs and network output
- authorization checks around HTTP actions and realtime subscriptions
- concurrency review for idempotency, leases, fencing and outbox claims
- misuse tests for malformed tokens, configuration and transport messages
- package and release checks for unexpected files, secrets and token-based publishing
- regression tests for each corrected finding

## Findings closed for 1.0.0

| ID | Severity | Area | Correction |
|---|---|---|---|
| GG-SEC-001 | High | Realtime replay | Replay now starts only after the channel subscription is authorized. A denied subscription cannot read retained events. |
| GG-SEC-002 | High | Error responses | Internal error details are removed from hidden server errors. Exposed details pass through secret redaction. |
| GG-SEC-003 | Medium | SVG analytics output | Chart dimensions, colors, fonts and titles are bounded and sanitized before SVG generation. |
| GG-SEC-004 | Medium | PostgreSQL idempotency | Reservation uses conflict-safe insert behavior followed by a locked read, preventing concurrent callers from both becoming the first writer. |
| GG-SEC-005 | Medium | Redis locks | Redis locks now support renewal, ownership checks and increasing fencing tokens through atomic scripts. |
| GG-SEC-006 | Medium | Retry behavior | Generic `TypeError` values are no longer retried by default. Applications must opt in when an operation is known to be safe to repeat. |
| GG-SEC-007 | Medium | Audit redaction | Secret-key matching handles common separators and case styles. Redaction and stable serialization now tolerate cycles and depth limits. |
| GG-SEC-008 | Medium | Input boundaries | HTTP methods, cookies, action definitions, OAuth settings, lock settings and realtime channels now have runtime validation and size limits. |
| GG-SEC-009 | Low | Realtime protocol | Malformed JSON closes a socket with protocol code 1007 instead of leaking an unhandled parser error. |
| GG-SEC-010 | Low | Operator sessions | Session metadata is omitted from operator output unless the application supplies an explicit public mapping function. |

## Result

Release-blocking findings open at the end of this review:

| Severity | Open |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

The fixes are covered by automated regression tests. The release verification task also checks TypeScript, documentation rules, package contents, secret patterns, local load behavior and a generated npm tarball.

## Limits of this review

This audit does not prove that every application using GuildGate is secure. The application still owns TLS, proxy trust, database roles, secret storage, Discord permissions, custom authorization callbacks, custom stores, retention and incident response.

Live Redis, PostgreSQL, Discord and multi-instance tests must be repeated in the target deployment. The review handoff in `EXTERNAL_REVIEW_GUIDE.md` is available for teams that require an independent assessment or compliance evidence.
