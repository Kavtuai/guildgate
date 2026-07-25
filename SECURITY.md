# Security policy

## Supported versions

Until `1.0.0`, only the newest released minor version receives security fixes. After `1.0.0`, the support window will be stated here before each branch is opened.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub private vulnerability reporting for `kavtuai/guildgate` when the repository is available. Include:

- Affected version or commit.
- Required configuration.
- Reproduction steps or a small proof of concept.
- Expected and observed behavior.
- Possible impact.
- Any temporary mitigation already tested.

Do not include real bot tokens, OAuth secrets, session cookies, database credentials, or user data. Replace them with test values.

## Response process

The maintainer will first confirm receipt, reproduce the report, assign severity, and decide whether a private patch branch is needed. Publication timing depends on impact, fix availability, and coordination with affected adapter maintainers.

A security release should include:

- A fixed package version.
- Affected version range.
- Concrete impact and prerequisites.
- Upgrade or mitigation steps.
- Credit when the reporter requests it.

## Security boundaries

The package rejects several unsafe production settings and implements controls described in `docs/threat-model.md`. It does not configure the host, proxy, TLS, firewall, database roles, secret manager, backups, or application-specific authorization policy.
