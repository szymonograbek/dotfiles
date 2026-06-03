---
name: jira-api
description: "Make Jira Cloud REST API requests via a local helper script using credentials from environment variables or macOS Keychain. Use by default for Jira work: reading, searching, updating tickets, JQL, comments, transitions, ADF payloads, or any request involving Jira issues."
---

# Jira API

Use the helper script by default for Jira work.

## Prerequisites

- `node` >= 18 on PATH.
- Jira Cloud credentials in env or macOS Keychain:
  - `JIRA_BASE_URL` or `ATLASSIAN_SITE_URL` (example: `https://example.atlassian.net`)
  - `JIRA_EMAIL` or `ATLASSIAN_EMAIL`
  - `JIRA_API_TOKEN` or `ATLASSIAN_API_TOKEN`

Keychain setup examples:

```sh
security add-generic-password -a "$USER" -s JIRA_BASE_URL -w 'https://example.atlassian.net'
security add-generic-password -a "$USER" -s JIRA_EMAIL -w 'me@example.com'
security add-generic-password -a 'me@example.com' -s JIRA_API_TOKEN -w 'TOKEN'
```

## Script

The helper script lives **in the same directory as this SKILL.md file** (`scripts/jira.mjs`).
Resolve it against the skill directory — do **not** search the repo. Use it directly:

```sh
node <skill-dir>/scripts/jira.mjs <command> ...
```

The script emits JSON and exits non-zero on hard errors.

Common commands:

```sh
node <skill-dir>/scripts/jira.mjs me
node <skill-dir>/scripts/jira.mjs projects [query]
node <skill-dir>/scripts/jira.mjs issue ABC-123
node <skill-dir>/scripts/jira.mjs comments ABC-123
node <skill-dir>/scripts/jira.mjs search 'project = ABC AND statusCategory != Done ORDER BY updated DESC' 'summary,status,assignee'
node <skill-dir>/scripts/jira.mjs transitions ABC-123
node <skill-dir>/scripts/jira.mjs transition ABC-123 31
node <skill-dir>/scripts/jira.mjs add-comment ABC-123 'Plain text comment'
echo '{"fields":{"summary":"New summary"}}' | node <skill-dir>/scripts/jira.mjs edit ABC-123
node <skill-dir>/scripts/jira.mjs request GET /rest/api/3/issue/ABC-123   # raw escape hatch
```

## Workflow

1. Identify the issue key from the user request or branch name. Ask only if unavailable.
2. Read before writing:
   - `issue <KEY>` for compact issue details with plain-text description.
   - `comments <KEY>` if comment context matters.
   - `transitions <KEY>` before changing status.
3. For text writes, prefer purpose-built commands:
   - `add-comment <KEY> <text>` creates valid ADF.
   - `edit <KEY>` reads raw Jira JSON from stdin.
4. For unsupported endpoints, use `request METHOD PATH [json]`.
5. Summarize changed issue keys and API errors. Never expose tokens.

## Notes

- Jira rich text fields use Atlassian Document Format (ADF). The helper only converts plain text comments to simple ADF paragraphs.
- For descriptions or complex rich text fields, send explicit ADF JSON via `edit` or `request`.
- Use `/rest/api/3/search/jql` for JQL search; pagination uses `nextPageToken`.
