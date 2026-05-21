---
name: daily-todoist-work
description: Log the user's completed development work (merged PRs and commits landed on the default branch) into Todoist as completed tasks. Use when the user asks to "log work to Todoist", "log what I did today", "add today's PRs to Todoist", "log this week's work", or any similar request to mirror VCS/GitHub activity into Todoist. Defaults to today; supports custom date ranges from the past.
---

# Daily Todoist Work Logger

Mirrors the user's completed work in the current repo into Todoist as already-completed tasks. One Todoist task per merged PR; orphan commits on the default branch (not part of any collected PR) get their own task.

## Prerequisites

- `TODOIST_API_KEY` env var must be set (the Todoist API token).
- `git`, `gh`, `jq`, `node` (>= 18) on PATH.

## Scripts

Both live next to this file in `scripts/`.

- `collect-work.sh <range>` — collects PRs + orphan commits from the current repo for a date range; emits one JSON blob.
- `todoist.mjs <subcommand> ...` — thin Todoist API v1 client. Subcommands: `projects`, `sections <projectId>`, `tasks <projectId>`, `completed <projectId> <sinceISO> <untilISO>`, `add` (reads JSON array from stdin), `complete <id>...` (closes *now*), `complete-at` (reads `[{id, dateCompleted}]` from stdin; backdates via Sync API). All output JSON.

## Workflow

### 1. Collect work

Run `scripts/collect-work.sh <range>` from the repo working directory. `<range>` defaults to `today`. Accepted forms:

| Phrase | Meaning |
|---|---|
| (none) / `today` | local today |
| `yesterday` | local yesterday |
| `this week` | Monday → now |
| `last N days` | last N calendar days incl. today |
| `YYYY-MM-DD` | that day |
| `YYYY-MM-DD..YYYY-MM-DD` | inclusive range |

Output JSON shape:

```
{
  "range":   { "startLocal", "endLocal", "startISO", "endISO" },
  "repo":    { "name", "owner", "defaultBranch", "isGithub" },
  "user":    { "name", "email" },
  "prs":     [ { "number", "title", "url", "mergedAt", "headRefName", "mergeCommit" } ],
  "commits": [ { "sha", "shortSha", "subject", "authoredAt", "url" } ],
  "warnings": [ ... ]
}
```

Surface any `warnings` to the user.

### 2. Pick the Todoist project

`scripts/todoist.mjs projects` → list. Match (case-insensitive, ignoring non-alphanumerics) against, in order:

1. `repo.name`
2. `repo.owner`

If multiple or none match, ask the user. Then `scripts/todoist.mjs sections <projectId>` and prefer a section named `Done` (case-insensitive); otherwise omit `sectionId`.

### 3. Build candidate tasks

- For each PR: `content = pr.title`, `description = "PR #<number> — <url>"`.
- For each orphan commit: `content = commit.subject`, `description = "<shortSha> — <url>"` (omit url if empty).

### 4. Deduplicate against Todoist

Fetch open and completed tasks in the project:

- Open:      `scripts/todoist.mjs tasks <projectId>`
- Completed: `scripts/todoist.mjs completed <projectId> <range.startISO> <range.endISO>` (widen `since` by ~30 days if unsure).

A candidate is a duplicate when **either** holds for any existing task:

- the candidate's URL fragment (`/pull/<n>` or `/commit/<sha>`) appears in the existing task's `content` or `description`, **or**
- the candidate's `content` matches the existing task's `content` exactly (case-insensitive, trimmed).

Skip duplicates; report them in the summary.

### 5. Insert and complete (backdated)

- If candidate count > 10, confirm with the user first.
- **Add**: pipe a JSON array of `{ content, description, projectId, sectionId? }` into `scripts/todoist.mjs add`. Preserve the order so each created task lines up with its source PR/commit.
- **Complete with the real date**: build `[{ id, dateCompleted }]` where `dateCompleted` is the PR's `mergedAt` (or the commit's `authoredAt`, normalized to UTC, `Z` suffix), and pipe it into `scripts/todoist.mjs complete-at`. This uses the Sync API's `item_complete` with `date_completed`, so each task is recorded as completed on the day the work actually landed.

> Do **not** call `complete` before `complete-at` on the same task — once a task is closed via REST, `item_complete` becomes a no-op and the timestamp won't backdate.

### 6. Summarize

Report added & completed (with links), skipped duplicates, and any failures.

## Rules

- Never create commits, push, or modify the repo.
- Never invent PRs/commits — only use what `collect-work.sh` returns.
- If `repo.isGithub` is false, `prs` will be empty; proceed with commits only.
