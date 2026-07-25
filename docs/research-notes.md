# Research notes

Reviewed on 25 July 2026.

## Writing review

Wikipedia’s “Signs of AI writing” page is an editing essay, not a conclusive detector. It groups possible signs under content, vocabulary and grammar, formatting, user-directed boilerplate, markup artifacts, citation faults, edit summaries, and older model behaviors.

GuildGate applies that material in two places:

- `docs/WRITING_STYLE.md` contains the full repository checklist in project terms.
- `guildgate-writing-check` rejects common assistant boilerplate, internal citation artifacts, tracking query strings, unfinished placeholders, and a selected list of vague promotional words outside the checklist itself.

Source: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing

## Discord OAuth and guild access

The Discord OAuth authorization-code flow supports a `state` value and Discord recommends it for request integrity. GuildGate hashes a one-time state record and binds it to a separate browser nonce cookie. The callback consumes the state once.

The default scopes are `identify` and `guilds`. The first identifies the signed-in user. The second returns the user’s guild list and guild permission value.

Discord permission values are serialized as strings because the bitfield can exceed safe JavaScript number precision. GuildGate parses them with `BigInt` and keeps user and bot permission checks separate.

Sources:

- https://docs.discord.com/developers/topics/oauth2
- https://docs.discord.com/developers/resources/user#get-current-user-guilds
- https://docs.discord.com/developers/topics/permissions

## HTTP and session controls

OWASP session guidance recommends meaningless session identifiers with server-side state. GuildGate returns a random opaque token once and stores only its SHA-256 hash.

Cookie-authenticated write requests are exposed to cross-site request forgery. GuildGate requires an exact allowed origin and a session-bound CSRF token for unsafe methods.

Sources:

- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

## WebSocket controls

OWASP WebSocket guidance calls for origin validation, session handling beyond the initial handshake, authorization for individual messages or actions, payload limits, and logging without secret content.

GuildGate validates the origin and session at attach time, rechecks the session on a timer, authorizes each subscription, limits messages and subscriptions, and closes slow or expired connections.

Source: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html

## Rate limits and retries

Discord applies route and global HTTP rate limits and returns response data that clients must respect. GuildGate’s inbound dashboard limits are separate from Discord’s outbound limits. The OAuth client honors `retry_after` under one total deadline. The guild authorizer surfaces a Discord 429 as a typed rate-limit error. Applications already using a Discord library REST manager should reuse that manager for broader bot traffic.

Source: https://docs.discord.com/developers/topics/rate-limits

## npm publishing

npm trusted publishing uses OIDC from a supported CI provider instead of a long-lived npm publishing token. Current npm documentation also describes automatic provenance for supported trusted-publishing workflows.

The included release workflow grants `id-token: write`, runs tests, and publishes on a GitHub release. The npm package page must first be configured to trust the repository and workflow.

Source: https://docs.npmjs.com/trusted-publishers
