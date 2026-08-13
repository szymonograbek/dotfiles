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
3. Inspect repository state and define the review range:
   - Check current branch/bookmark and upstream/tracking state.
   - Determine the PR base before summarizing or renaming: prefer an existing PR base, then an explicit user base, then the nearest relevant tracked ancestor/bookmark. Use the repository default only when ancestry confirms the work is directly based on it; stacked work targets its parent branch/bookmark.
   - Inspect the complete diff and every commit/change in `base..head`, not only the working copy or top commit. This is a mandatory precondition to writing PR metadata: run an explicit range log and range diff even if status, individual files, or Jira appear sufficient.
   - Check uncommitted changes. In jj, the working copy `@` is already a commit: modified files or an empty description are metadata/readiness work, not Git-style uncommitted changes.
   - Inspect recent local branch and commit names to infer repo naming patterns.
   - Also inspect recent commits on the base branch before choosing or rewriting commit/change names; use those existing base-branch subjects as the primary naming convention signal.
4. Validate review readiness:
   - Confirm the work is on a feature branch, not a protected/base branch such as `main`, `master`, `develop`, or `trunk`.
   - For git, ensure all intended changes are committed. If dirty, ask whether to commit them or leave them out; do not edit files to resolve dirty state. For jj, do not stop merely because `@` contains changes or lacks a description; validate that finished working-copy commit like every other change in the range.
   - Ensure branch/bookmark name includes the Jira key and follows the repo's observed naming pattern.
   - Ensure every commit/change included in the PR—not only the topmost one—has a useful Jira-keyed description following the repo's observed pattern, prioritizing recent base-branch subjects when styles differ. Preserve distinct commit scopes; do not collapse the stack merely to normalize metadata.
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
   - Use the already-verified review base; do not substitute the repository default for a stacked parent.
   - Derive the title and `What`/`Why`/`How` body from the complete `base..head` diff and commit/change set, not only `@` or the top commit.
   - Write for technical reviewers: include the complete scope, architectural/data-flow approach, rationale for non-obvious choices, relevant trade-offs, failure/compatibility behavior, and review hotspots. Keep it focused, not terse.
   - Assign the current GitHub user.
8. Update the Jira description:
   - Write for non-technical product and QA readers. Assume this may be used to understand and test a TestFlight/build release.
   - Describe what changed from the app user's perspective: where the behavior appears, what the user can now do or observe, relevant preconditions/roles, and visible failure or edge behavior.
   - Omit architecture, source files, internal state/data flow, code terminology, and implementation rationale. Those belong in the PR.
   - Use past/present tense, not future planning.
   - Do not include developer-only checks such as typecheck, lint, unit tests, branch names, commit hashes, or implementation files in Jira testing steps.
   - If the description has no clear structure, use these headers exactly:
     - `What changed`
     - `Acceptance criteria`
     - `QA testing steps`
   - `What changed`: clear app-perspective summary plus PR link; mention affected users and visible behavior rather than implementation.
   - `Acceptance criteria`: observable pass/fail outcomes QA can verify in-app, including meaningful roles, states, and edge behavior.
   - `QA testing steps`: concrete device/build or in-app steps for QA, including account/data preconditions, actions, and expected visible results.
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
