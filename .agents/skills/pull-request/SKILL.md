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

Write for a technical reviewer who has not followed the implementation work. Keep it focused, but detailed enough to understand the change and review its design without reconstructing intent from the diff.

- `What`: describe the complete behavioral and technical scope across the full PR range. Name the affected flow, component, boundary, or system and important scope exclusions.
- `Why`: explain the original problem or requirement, its user/system impact, and why the chosen behavior or architecture was necessary. Include the rationale for non-obvious changes instead of merely restating what changed.
- `How`: explain the implementation at the architectural level, including important data/control flow, state ownership, API/schema changes, compatibility, migration, lifecycle, and failure behavior when applicable. Explain key design choices and trade-offs, rejected simpler-looking approaches when relevant, and concrete reviewer hotspots.
- Prefer several specific bullets per section when the PR contains multiple commits or concerns. Do not make the description artificially concise at the expense of technical context.
- Derive the description from the complete base-to-head diff and commit set, not only the top commit.
- Call out meaningful review hotspots and scope limitations in `How` when relevant.
- Derive every claim from the diff, repository, checks, or linked issue. Do not invent context.
- Prefer focused, information-dense bullets over long narrative, but include enough technical detail for an informed review.
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
