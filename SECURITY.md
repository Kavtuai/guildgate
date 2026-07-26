# Security policy

## Supported versions

| Version | Status |
|---|---|
| `1.0.x` | Supported |
| `0.1.x` | Unsupported; upgrade to `1.0.x` |
| Older versions | Unsupported |

The newest stable minor line receives security fixes. A longer support period may be announced for a specific release.

## Private reporting

Do not open a public issue for a suspected vulnerability. Use GitHub private vulnerability reporting for `Kavtuai/guildgate`.

Include:

- affected version or commit
- required configuration
- reproduction steps or a small proof of concept
- expected and observed behavior
- possible impact
- temporary mitigation already tested

Never include real bot tokens, OAuth secrets, session cookies, database credentials or user data.

## Response targets

These are maintainer targets, not guaranteed resolution times.

| Stage | Target |
|---|---:|
| Receipt confirmation | 3 business days |
| Initial severity and reproduction update | 7 business days |
| Critical mitigation or release plan | 3 business days after confirmation |
| High-severity mitigation or release plan | 10 business days after confirmation |

Complex reports and upstream coordination can change the schedule. Material changes will be shared through the private report.

## Disclosure

A security release should state the affected versions, prerequisites, impact, fixed version and upgrade steps. Reporter credit is included when requested. Public timing is coordinated with the reporter when practical.

## Security boundaries

GuildGate enforces the controls described in `docs/threat-model.md`. It does not configure the host, TLS, proxy trust, firewall, database roles, secret manager, backups, Discord application permissions or application-specific authorization rules.

The completed maintainer review is recorded in `SECURITY_AUDIT.md`. `EXTERNAL_REVIEW_GUIDE.md` describes a handoff for teams that commission a separate assessment.
