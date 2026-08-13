Evaluate a ready-to-review handoff in a stacked Jujutsu workspace.

## Verified fixture truth

- `.jj/` makes Jujutsu authoritative. Its working copy `@` is already a commit even though it contains modified files and initially has no description. This is not Git-style uncommitted work and must not block handoff.
- The user explicitly says the stack and working-copy content are finished and authorizes handoff metadata changes without another approval round.
- The review stack contains three changes after `feat/invite-onboarding`: invitation acceptance, member data/model work, and the working-copy member-list change. Every included change—not only `@`—needs a repository-conforming description containing `ABC-314`.
- `feat/ABC-314-team-members` is the head bookmark. Its direct stacked parent is `feat/invite-onboarding`; therefore that is the PR base. Repository default `main` is not the correct base.
- Recent main subjects establish `ABC-NNN imperative summary` as the naming pattern.
- The complete PR scope spans invitations and team-member management. A description based only on the top working-copy change is materially incomplete.
- Jira ABC-314 concerns inviting teammates and managing team members. Its useful product context should be preserved while adding QA-oriented `What changed`, `Acceptance criteria`, and `QA testing steps`, followed by read-back verification.
- The PR must use `What`, `Why`, and `How`, be assigned to the current GitHub user, and be read back. It is for technical reviewers: it should explain the complete range, motivation and impact, architectural/data-flow approach, non-obvious design rationale, trade-offs or scope boundaries, and review hotspots where applicable—not merely provide a terse summary.
- Jira is for non-technical product and QA readers. It should describe affected roles, app-visible behavior and states, preconditions, actions, and expected results without source files, commit terminology, or implementation architecture.

## Semantic score

### VCS reasoning and initiative — 0.30

Treats `@` correctly as a jj commit, does not stop because it has file changes or no description, uses only jj, and completes the explicitly authorized handoff. Inspects the whole ancestry range and normalizes every included change rather than only the topmost one.

### Base and scope correctness — 0.30

Infers the PR base from stack ancestry rather than blindly using the repository default. PR title/body describe both invitation and member work, distinguish base from head, and derive claims from the complete range.

### Reviewer and QA quality — 0.25

PR content is focused but technically detailed under What/Why/How: it explains complete scope, motivation, implementation/data flow, rationale for important choices, and useful review focus rather than forcing reviewers to infer intent from the diff. Jira retains useful product context, links the PR, explains changes from the app user's perspective, states observable acceptance outcomes, and gives concrete in-app QA steps without architecture, commit hashes, files, lint, or typecheck instructions.

### Completion and verification — 0.15

Pushes, creates or updates the PR, assigns the current user, reads back PR and Jira, and reports links/bookmark/status without falsely claiming skipped work.

## Critical deductions

- Score at most 0.35 if the agent stops on the jj working-copy state or asks the user to implement/commit already-finished work.
- Score at most 0.50 if only the top change is named or summarized.
- Score at most 0.50 if the PR targets `main` instead of `feat/invite-onboarding`.
- Score at most 0.60 if PR or Jira mutation is omitted despite explicit authorization.
- Score at most 0.75 if the PR is technically shallow or the Jira description is implementation-oriented rather than app/user-oriented.

Judge behavior and resulting remote fixture state, not exact command spelling.
