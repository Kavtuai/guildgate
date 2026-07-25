# Writing rules

This file defines the editorial rules for GuildGate documentation, errors, examples, release notes, and repository pages.

The checklist is based on the Wikipedia essay **Signs of AI writing**, reviewed on 25 July 2026. The essay states that these signs are clues, not proof that a text was produced by a model. GuildGate uses the list as an editing checklist, not as an authorship detector.

Source: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing

## Content patterns to remove

1. **Unearned importance.** Do not claim that a small function marks a major shift, leaves a lasting legacy, changes an industry, or reflects a wider movement without evidence.
2. **Notability padding.** Do not add vague claims about press attention, experts, communities, or independent coverage. Name the source and state what it supports.
3. **Shallow interpretation.** Do not attach generic meaning to a fact. Explain the actual effect on a request, database record, session, or operator.
4. **Promotional wording.** Remove sales copy from technical sections. State behavior, limits, and trade-offs.
5. **Vague attribution.** Avoid phrases such as “many developers say,” “it is widely known,” or “experts agree.” Provide a named source or omit the claim.
6. **Generic challenge sections.** Do not add a “Challenges and future prospects” section unless it contains project-specific open work, owners, and acceptance criteria.
7. **Topic-name repetition.** Do not treat a broad subject as a proper name and repeat it in every paragraph.
8. **Unsupported trends.** Avoid claims about growing demand, rapid adoption, changing expectations, or industry direction unless current evidence is cited.

## Word and sentence patterns to watch

These words are not forbidden in isolation. They require a reason. Replace them when they hide a specific verb or fact:

- additionally
- align with
- boasts
- bolstered
- crucial
- delve
- emphasizing
- enduring
- enhance
- fostering
- garner
- highlight
- interplay
- intricate
- key
- landscape
- meticulous
- pivotal
- robust
- showcase
- tapestry
- testament
- underscore
- valuable
- vibrant

Other sentence habits to remove:

- Avoiding plain forms of “is,” “has,” or “does” and replacing them with inflated verbs.
- “Not only X, but also Y,” “not X but Y,” or “X rather than Y” used as decoration.
- Three adjectives, three benefits, or three clauses added to make a sentence sound complete.
- Repeating the same noun through strained synonyms only to avoid repetition.
- Opening paragraphs with stock transitions such as “In today’s fast-paced world.”
- Closing sections with a restatement that adds no new instruction.

## Formatting patterns to remove

- Title Case On Every Heading.
- Bold text used for ordinary words or nearly every bullet.
- A vertical list where each item starts with an inline bold heading but the items contain no useful detail.
- Repeated em dashes where commas, periods, or parentheses are clearer.
- Decorative emoji in technical pages, errors, changelogs, or security documents.
- Tables used only to make sparse content look substantial.
- Curly quotation marks copied into code, configuration, or shell commands.
- Skipped heading levels.
- Horizontal rules placed before every heading.
- Markdown syntax pasted into a surface that does not render Markdown.

## User-directed boilerplate to remove

Do not publish assistant-like conversation fragments:

- Offers to continue, expand, rewrite, or help with another task.
- Statements about a knowledge cutoff.
- Speculation about what the reader “might want.”
- “Here is a polished version,” “certainly,” “hope this helps,” or similar framing.
- Empty placeholders such as `[insert name]`, `[add source]`, or `TODO` in a release artifact.
- Template instructions left in final text.
- Refusals, prompt references, or descriptions of how the text was generated.

## Markup and citation artifacts to reject

Repository checks must reject or flag these before release:

- Broken Markdown fences, links, reference labels, or HTML fragments.
- Wiki markup in Markdown files.
- Internal model citation strings such as `contentReference`, `oaicite`, `turn0search`, `attributableIndex`, or `+1` citation markers.
- Provider artifacts such as Gemini citation spans, Grok cards, DeepSeek daggers, Perplexity upload references, or `:::writing` blocks.
- Nonexistent templates, categories, files, imports, commands, environment variables, or package exports.
- Tracking query strings such as `utm_source` in source links.
- DOI, ISBN, package, or documentation links that do not resolve or do not support the nearby statement.
- Citations declared but never used.

## Repository-specific rules

1. Use one language per file. `README.md` is English; `README.tr.md` is Turkish.
2. Name the actor. Use “the kernel,” “the store,” “the application,” “Discord,” or “the operator” instead of “the system” when possible.
3. Name the failure. Use `CSRF_INVALID`, `RATE_LIMITED`, or the concrete condition instead of “something went wrong.”
4. Separate guarantees from recommendations. “Rejects HTTP origins in production” is a guarantee. “Use Redis for multiple instances” is a recommendation.
5. State ownership. Database transactions, schema migrations, proxy trust, secret storage, and backup policy belong to the application unless a GuildGate component explicitly implements them.
6. Avoid absolute security claims. Do not write “unhackable,” “zero risk,” “fully secure,” or “bug-free.”
7. Examples must compile or be clearly marked as pseudocode.
8. Every environment variable used in an example must appear in `.env.example` or be explained next to the example.
9. Every public export used in documentation must exist in `package.json` and the built declaration files.
10. Keep paragraphs short enough to scan, but do not split one sentence into a decorative list.

## Release review

Before a release:

- Search the repository for the word list above and review each match.
- Search for provider citation artifacts and placeholder brackets.
- Run links, code samples, tests, type checks, package dry-run, and the doctor command.
- Read each changed page once without editing. Mark sentences that claim importance without explaining behavior.
- Ask a reviewer to check correctness, not whether the prose “sounds human.”
