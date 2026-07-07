---
name: sentry-api
description: "Make Sentry REST API requests via a local helper script using credentials from environment variables or macOS Keychain. Use by default for Sentry work: reading issues/errors, events, stack traces, releases, projects, organizations, users, or any request involving Sentry incidents or event IDs."
---

# Sentry API

Use the helper script by default for Sentry work. Avoid the Sentry MCP unless explicitly requested.

## Prerequisites

- `node` >= 18 on PATH.
- Sentry credentials in env or macOS Keychain:
  - `SENTRY_AUTH_TOKEN` (required)
  - `SENTRY_ORG` (optional default org slug; if omitted and the token can access exactly one org, the script uses that org)
  - `SENTRY_BASE_URL` (optional; defaults to `https://sentry.io`)

Keychain setup examples:

```sh
security add-generic-password -a "$USER" -s SENTRY_AUTH_TOKEN -w 'TOKEN'
security add-generic-password -a "$USER" -s SENTRY_ORG -w 'org-slug'
security add-generic-password -a "$USER" -s SENTRY_BASE_URL -w 'https://sentry.io'
```

## Script

The helper script lives **in the same directory as this SKILL.md file** (`scripts/sentry.mjs`).
Resolve it against the skill directory — do **not** search the repo. Use it directly:

```sh
node <skill-dir>/scripts/sentry.mjs <command> ...
```

The script emits JSON and exits non-zero on hard errors.

Common commands:

```sh
node <skill-dir>/scripts/sentry.mjs me
node <skill-dir>/scripts/sentry.mjs organizations
node <skill-dir>/scripts/sentry.mjs projects [org]
node <skill-dir>/scripts/sentry.mjs issues <project> [query] [limit]        # uses SENTRY_ORG
node <skill-dir>/scripts/sentry.mjs issues --org <org> <project> [query] [limit]
node <skill-dir>/scripts/sentry.mjs issue <issueId>                          # uses SENTRY_ORG
node <skill-dir>/scripts/sentry.mjs issue --org <org> <issueId>
node <skill-dir>/scripts/sentry.mjs events <issueId> [limit]                 # uses SENTRY_ORG
node <skill-dir>/scripts/sentry.mjs events --org <org> <issueId> [limit]
node <skill-dir>/scripts/sentry.mjs latest-event <issueId>                   # uses SENTRY_ORG
node <skill-dir>/scripts/sentry.mjs latest-event --org <org> <issueId>
node <skill-dir>/scripts/sentry.mjs event <issueId> <eventId>                # uses SENTRY_ORG
node <skill-dir>/scripts/sentry.mjs event --org <org> <issueId> <eventId>
node <skill-dir>/scripts/sentry.mjs event-debug <issueId> <eventId> [breadcrumbs] [frames]
node <skill-dir>/scripts/sentry.mjs latest-debug <issueId> [breadcrumbs] [frames]
node <skill-dir>/scripts/sentry.mjs tags <issueId>
node <skill-dir>/scripts/sentry.mjs tag-values <issueId> <tag> [limit]
node <skill-dir>/scripts/sentry.mjs releases <project> [limit]               # uses SENTRY_ORG
node <skill-dir>/scripts/sentry.mjs releases --org <org> <project> [limit]
node <skill-dir>/scripts/sentry.mjs request GET /api/0/organizations/org-slug/issues/123/events/latest/
```

Useful issue queries:

```sh
'is:unresolved level:error'
'is:unresolved user.email:person@example.com'
'error.handled:false release:1.2.3'
```

## Workflow

1. Resolve org/project from the user request, `SENTRY_ORG`, or `projects` output. Ask only if unavailable.
2. Read before acting:
   - `issues <project> <query>` or `issues --org <org> <project> <query>` for matching issue groups.
   - `issue <issueId>` for group metadata.
   - `latest-event <issueId>` or `events <issueId>` for stack trace/context.
   - `latest-debug <issueId>` or `event-debug <issueId> <eventId>` for exception frames plus recent breadcrumbs.
   - `tags <issueId>` and `tag-values <issueId> <tag>` for release/environment/device breakdowns.
3. Prefer purpose-built commands for readable compact JSON.
4. For unsupported endpoints, use `request METHOD PATH [json]`.
5. Summarize issue IDs, project, release/environment, culprit, and evidence. Never expose tokens.

## Notes

- Sentry issue IDs are group IDs, not Jira-style keys.
- `me` may return `user: null` for organization/internal tokens that cannot read `/users/me`; check `.organizations[]` in that output.
- `issues`, `events`, `tag-values`, and `releases` follow Sentry cursor pagination up to the requested limit and emit `.issues[]`, `.events[]`, `.tagValues[]`, and `.releases[]` respectively.
- Sentry search syntax is passed through unchanged; quote queries in the shell.
