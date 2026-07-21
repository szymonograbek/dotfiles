---
name: pull-request
description: Create or update reviewer-friendly GitHub pull requests with consistent, evidence-based descriptions. Use when opening, editing, or preparing a pull request for review.
model: gpt-5.6-terra
effort: low
---

# Pull Request

## Workflow

1. Use `gh` to check whether a PR already exists for the current branch.
2. Determine the base branch from the existing PR, the user, or the repository default.
3. Before writing, inspect:
   - The complete diff against the base branch.
   - Commits included in the PR.
   - Relevant Jira issue or other supplied context.
4. If a PR exists, update it instead of creating another one.
5. Assign the current GitHub user to the PR.
6. Create or update the description using the exact template below.
7. Read the rendered PR back with `gh pr view` and verify its content and formatting.

## Description quality

Write for a reviewer who has not followed the implementation work.

- State concrete behavior and scope. Name the affected flow, component, or system.
- Explain the problem or requirement that motivated the change and its user or system impact.
- Summarize the implementation at the architectural level, including important data flow, state, API, migration, compatibility, or trade-off decisions.
- Call out meaningful review hotspots and scope limitations in `How` when relevant.
- Derive every claim from the diff, repository, checks, or linked issue. Do not invent context.
- Prefer concise bullets, but include enough detail for an informed review.
- Avoid vague statements such as “updated logic,” “fixed issue,” or “added improvements.”
- Do not narrate files line by line or repeat the PR title.

## Required template

Use these headings exactly and in this order so formatting remains stable.

```md
## What
- [Concrete behavior or capability changed]
- [Scope boundaries or notable user-visible effects]

## Why
- [Problem, requirement, or failure mode]
- [Why this approach/change is needed]

## How
- [Technical approach and key data/control flow]
- [Important design decision or trade-off]
- [Reviewer hotspot or scope limitation, if applicable]
```

For an existing PR, preserve still-valid reviewer context while normalizing it into this template. Remove stale claims.
