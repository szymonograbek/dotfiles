---
name: ready-to-review
description: Prepare an already-finished code change for review by finding its Jira ticket, validating branch/commit state, pushing, opening or updating a GitHub PR, and updating Jira. Use for creating/updating a PR from current work, pushing for review, or finishing Jira/PR handoff.
model: gpt-5.6-terra
effort: low
---

# Ready to Review

## Quick start

Turn already-finished local work into a reviewable PR and updated Jira ticket. Prefer `jj` when `.jj/` exists; otherwise use `git`.

## Scope guardrails

- This skill is handoff-only: validate, push, create/update PR, and update Jira.
- Do not implement fixes, hotfixes, refactors, cleanup, tests, or product-behavior changes.
- Do not inspect code to find additional issues unless needed to summarize the already-completed change.
- If readiness checks reveal a problem, report it and ask how to proceed instead of fixing it yourself.
- Only modify metadata needed for handoff: branch/bookmark names, commit/change descriptions, PR text, and Jira fields, subject to the workflow below.

## Workflow

1. Load required skills:
   - `jira-api` before any Jira read/write.
   - `pull-request` before creating or updating the PR.
   - `jj` if `.jj/` exists before any VCS command.
2. Find the Jira issue key:
   - Use a key explicitly provided by the user first.
   - Else parse the current branch name.
   - Else parse the current commit/change name or description.
   - If still missing, ask the user for the key.
3. Inspect repository state:
   - Check current branch/bookmark and upstream/tracking state.
   - Check uncommitted changes.
   - Check current commit/change name.
   - Inspect recent local branch and commit names to infer repo naming patterns.
   - Also inspect recent commits on the base branch before choosing or rewriting a commit/change name; use those existing base-branch commit subjects as the primary naming convention signal.
4. Validate review readiness:
   - Confirm the work is on a feature branch, not a protected/base branch such as `main`, `master`, `develop`, or `trunk`.
   - Ensure all intended changes are committed. If dirty, ask whether to commit them or leave them out; do not edit files to resolve dirty state.
   - Ensure branch/bookmark name includes the Jira key and follows the repo's observed naming pattern.
   - Ensure the current commit/change name includes the Jira key and follows the repo's observed pattern, prioritizing the naming style observed in recent base-branch commits over the local feature branch if they differ.
   - Before renaming branches/bookmarks, rewriting commits, or amending messages, state the planned change and ask if it is materially destructive or ambiguous.
   - If tests, lint, typecheck, merge status, or manual inspection reveal failures, stop and report them. Do not fix them under this skill.
5. Read Jira:
   - Use the Jira API helper to read the issue summary and existing plain-text description.
   - Preserve an existing useful structure; do not replace it wholesale unless it is empty or stale.
6. Push the branch/bookmark:
   - Push only after the state is clean and naming is acceptable.
   - Set upstream if missing.
7. Open or update the PR:
   - Follow the `pull-request` skill.
   - First check whether a PR already exists.
   - Assign the current GitHub user.
   - Use concise sections: `What`, `Why`, `How`.
8. Update the Jira description:
   - Write for QA and product, not engineers. Assume this may be used to test a TestFlight/build release.
   - Describe the user-visible behavior in past/present tense, not implementation details or future planning.
   - Do not include developer-only checks such as typecheck, lint, unit tests, branch names, commit hashes, or implementation files in Jira testing steps.
   - If the description has no clear structure, use these headers exactly:
     - `What changed`
     - `Acceptance criteria`
     - `QA testing steps`
   - `What changed`: concise user-facing summary plus PR link.
   - `Acceptance criteria`: observable pass/fail outcomes QA can verify in-app.
   - `QA testing steps`: concrete device/build or in-app steps for QA, including preconditions and expected results.
   - If the description already has a useful structure, adapt to it and update stale content without replacing good product context.
   - Use Atlassian Document Format JSON for rich-text description updates; Markdown is unreliable.
   - After writing, re-read the issue and verify the plain-text description is non-empty and QA-ready. If the read-back is empty or malformed, fix it before reporting success.
9. Final response:
   - Jira key and link if available.
   - PR link.
   - Branch/bookmark pushed.
   - Jira description updated.
   - Any skipped step or open question.

## Command guidance

- Always check for `.jj/` before VCS commands.
- For `jj`, prefer `jj status`, `jj log`, `jj bookmark list`, `jj describe`, `jj log -r 'ancestors(main, 20)'` or the repo's actual base bookmark, and `jj git push` as appropriate.
- For `git`, prefer `git status --short --branch`, `git branch --show-current`, `git log --oneline -n 20`, `git log --oneline origin/main -n 20` or the repo's actual base branch, and `git push -u origin HEAD` as appropriate.
- Use `gh pr view --json url` before creating a PR.
