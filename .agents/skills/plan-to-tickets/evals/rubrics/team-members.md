Evaluate the generated ticket set as one ordered implementation handoff. Judge meaning, traceability, and implementability rather than exact wording or a single ideal ticket count.

## Verified plan truth

The plan adds a read-only Team member directory reached from Team Settings. It settles these details:

- Parsed API boundary under `src/features/teams/members/`.
- `GET /v1/teams/{teamId}/members?cursor={cursor}`, omitting cursor initially.
- Page fields: members with `id`, `displayName`, role union `owner | admin | member`, nullable `avatarUrl`; nullable `nextCursor`.
- Invalid roles, IDs/names, or cursor values become `ApiFailure { kind: "unexpected" }`; partial members never reach UI.
- Extend `teamQueryKeys.members(teamId)`; infinite query uses `pageParam` and `nextCursor`; transport fields are not renamed/flattened.
- Thin route plus `TeamScreen`, and a Team Settings `Members` row navigating to the member route.
- Rows, title, role labels, initials fallback, and `{displayName}, {Role}` accessibility label.
- Exact behavior for initial skeleton, empty state, loaded order, refresh preservation/failure/retry, pagination gating/loading/failure/same-cursor retry, and first-ID-wins deduplication.
- Exact first-page handling for offline, forbidden, not-found, unauthenticated, and unexpected failures.
- Skeleton accessibility, error announcements, descriptive retry labels, and privacy-safe opened/page-loaded analytics.
- Read-only exclusions.
- Tests stay with relevant behavior. A final separate finished-feature verification ticket runs typecheck, tests, lint, and feasible `rn-iso` plus Argent checks.
- Data contract precedes screen integration; navigation depends on the screen's `teamId` contract.

## Scoring

### Decision preservation and traceability — 0.40

- Every settled contract, screen-state, error, accessibility, analytics, exclusion, testing, and sequencing decision appears in the ticket responsible for implementing or verifying it.
- Details are attached to the relevant ticket, not merely dumped into an unrelated overview or final verification ticket.
- No settled decision is weakened into “follow the plan,” “handle errors,” “add pagination,” or another vague placeholder.
- No contract field, state distinction, retry behavior, privacy boundary, or test obligation is silently lost or contradicted.

### Ticket implementability — 0.30

- An engineer can implement each ticket without reopening `plan.md` for its architecture, API/data contract, state behavior, failure behavior, scope, or acceptance criteria.
- In particular, any ticket implementing `TeamScreen` states the concrete UI states and transitions it owns; merely saying “implement TeamScreen” is materially insufficient.
- Implementation notes include settled paths, boundaries, query/cursor mechanics, ordering/deduplication, and dependencies where relevant.
- Acceptance criteria are observable and specific enough to distinguish success from partial implementation.
- Verification names the tests or checks needed for that ticket rather than postponing all validation.

### Boundaries and sequencing — 0.20

- Tickets are coherent, independently reviewable slices with no contradictory ownership or important orphaned work.
- Parsed data/query foundations precede dependent UI and integration.
- Navigation and route wiring are assigned clearly.
- Automated tests accompany their behavior; the final ticket verifies the integrated result rather than implementing missing functionality.
- Every ticket has separate stacked-commit guidance and explicit dependencies.

### Scope discipline and readability — 0.10

- No invitations, role editing, removal, search, sorting controls, member details, implementation, or remote issue creation are introduced.
- Tickets use the required sections, concrete titles, concise context, and distinguish required work from follow-ups.
- The final verification ticket includes feasible mobile simulator guidance and credential safety without pretending blocked states are reachable.

A score of 1.0 requires complete, correctly placed implementation detail. Deduct heavily when a detailed plan is reduced to component names or broad chores, even if another ticket or the final verification ticket vaguely references coverage.
