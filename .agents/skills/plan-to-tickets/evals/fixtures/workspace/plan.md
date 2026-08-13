# Team member directory implementation plan

## At a glance

**Spec:** Agreed Team member directory requirements
**Goal:** Add a read-only member directory reachable from Team Settings.
**Approach:** Establish a parsed, cursor-paginated team-members query boundary before building the screen and route integration.
**Status:** Agreed

## Relevant context

- **Fact:** The app uses Expo Router, TanStack Query, and feature code under `src/features/`.
- **Fact:** `app/teams/[teamId]/settings.tsx` is a thin route around `TeamSettingsScreen`.
- **Fact:** `src/api/request.ts` owns normalized failures: `unauthenticated`, `forbidden`, `not-found`, `offline`, and `unexpected`.
- **Fact:** Existing team query keys live in `teamQueryKeys`; this work must extend that namespace rather than create another one.
- **Constraint:** Settled API and screen-state behavior below must be preserved; it is not implementation latitude.

## Decisions

### Member-directory boundary and transport contract

**Choice:** Create the boundary under `src/features/teams/members/`. Request `GET /v1/teams/{teamId}/members?cursor={cursor}`, omitting `cursor` on the first page. Preserve this response shape:

```ts
type TeamMembersPage = {
  members: Array<{
    id: string;
    displayName: string;
    role: "owner" | "admin" | "member";
    avatarUrl: string | null;
  }>;
  nextCursor: string | null;
};
```

Parse at the API boundary. Malformed roles, missing IDs/names, and invalid cursor values become `ApiFailure` with `kind: "unexpected"`; UI code receives no partially valid members. Do not flatten or rename transport fields.

**Why:** A strict boundary prevents malformed transport data and contract knowledge from leaking into UI state.
**Alternatives:** Parsing in `TeamScreen` and accepting partially valid members were rejected because they weaken type safety and distribute contract handling.

### Query ownership and pagination

**Choice:** Add `teamQueryKeys.members(teamId)` as the infinite-query root. Each request receives TanStack Query's `pageParam`; `nextCursor` supplies the next page parameter. Deduplicate repeated IDs across pages by retaining the first occurrence in API order.

**Why:** This extends existing query ownership and makes cursor retry and ordering deterministic.
**Alternatives:** A second query-key namespace, offset pagination, and last-occurrence-wins deduplication were rejected as inconsistent with the app and API.

### TeamScreen composition and entry

**Choice:** Create a thin route at `app/teams/[teamId]/members.tsx`, with `TeamScreen` under `src/features/teams/members/`. Add a `Members` row to `TeamSettingsScreen` navigating to `/teams/{teamId}/members`. The screen's public input is `teamId`.

Rows show avatar, `displayName`, and `Owner`, `Admin`, or `Member`. Missing avatars use initials derived from `displayName`. Each row's accessibility label is `{displayName}, {Role}`. The title is `Members`.

**Why:** Thin routing and feature-owned presentation match existing boundaries while keeping transport details out of the route.
**Alternatives:** Route-owned data logic and a generic cross-feature people screen were rejected as unnecessary indirection.

### Screen state model

**Choice:** Implement these distinct states and transitions:

- Initial load without cache: member-row skeleton, not a full-screen spinner.
- First-page empty success: `No members yet`, without Retry.
- Loaded pages: one continuous list in API order.
- Pull to refresh: retain rows with the native indicator; replace only after successful refresh.
- Refresh failure: retain stale rows and show non-blocking `Couldn't refresh members` with `Retry`.
- Pagination starts only from end-reached when `nextCursor` is non-null and no request is active.
- Pagination loading: retain rows and show one footer activity indicator.
- Pagination failure: retain rows and show footer `Couldn't load more members` with `Retry`; retry the same cursor without duplicate rows.

First-page failures are:

- `offline`: `You're offline` with `Retry`.
- `forbidden`: `You don't have access to this team`, without Retry.
- `not-found`: `This team is no longer available`, without Retry.
- `unauthenticated`: existing global sign-in handling; no TeamScreen-local state.
- `unexpected`: `Couldn't load members` with `Retry`.

**Why:** Initial, stale-data, and incremental failures have different recovery behavior and must not collapse into one generic error state.
**Alternatives:** Replacing stale rows during refresh, full-screen pagination errors, and a generic first-page error were rejected because they lose usable data or actionable recovery.

### Accessibility and observability

**Choice:** Hide skeletons from accessibility, announce errors when they appear, and give initial-load, refresh, and pagination Retry actions descriptive labels. Emit `team_members_opened` once when visible and `team_members_page_loaded` after every successful page with `team_id`, `page_index`, and `member_count`; never include member names, avatar URLs, or IDs.

**Why:** The screen must remain understandable across asynchronous states without exposing member data through analytics.
**Alternatives:** Generic Retry labels and member-level analytics payloads were rejected for accessibility and privacy reasons.

### Scope boundary

**Choice:** Keep this release read-only. Invitation, role editing, removal, search, sorting controls, and member details are excluded.

**Why:** Those capabilities require separate permissions and mutation contracts.
**Alternatives:** Bundling member management into the directory was rejected to keep this change reviewable and safe.

## Proposed architecture and data flow

1. The thin route passes `teamId` to `TeamScreen`.
2. `TeamScreen` calls a feature-owned infinite query keyed by `teamQueryKeys.members(teamId)`.
3. The query passes `pageParam` to the member API client; the first request omits cursor and later requests use `nextCursor`.
4. The API boundary validates the full page before exposing typed members.
5. The query layer retains page order and applies first-ID-wins deduplication.
6. `TeamScreen` renders initial, loaded, refresh, pagination, and first-page failure states without owning transport parsing.
7. Team Settings provides the route entry point after the screen's `teamId` contract exists.

## API, schema, and UI changes

- Add the `TeamMembersPage` parsed boundary and request operation under `src/features/teams/members/`.
- Add `teamQueryKeys.members(teamId)` and feature-owned infinite-query behavior.
- Add `TeamScreen`, member rows, skeleton/empty/error/footer presentation, retries, accessibility, and analytics.
- Add `app/teams/[teamId]/members.tsx` and the Team Settings `Members` navigation row.
- Do not modify server schema, normalized `ApiFailure`, or unrelated team-management behavior.

## Implementation steps

1. Add and unit-test the parsed member-page contract, API request, query key, cursor pagination, same-cursor retry, and first-ID-wins deduplication.
2. Add and component-test `TeamScreen`, rows, every initial/loaded/refresh/pagination/failure state, retry behavior, role and initials presentation, accessibility, and analytics.
3. Add and test the thin route, `teamId` forwarding, and Team Settings navigation entry.
4. Perform separate finished-feature verification after all implementation work.

## Testing and acceptance coverage

- **Transport safety:** Unit-test every malformed field, invalid cursor, and all valid roles; no partial member reaches UI.
- **Pagination correctness:** Test `pageParam`, `nextCursor`, same-cursor retry, first-ID-wins deduplication, order, and no duplicate rows.
- **Screen behavior:** Component-test every first-page state, refresh preservation/failure, pagination loading/failure/retry, role labels, initials, and all exact messages.
- **Accessibility and privacy:** Test row labels, hidden skeletons, error announcements, descriptive Retry labels, and analytics payload exclusions.
- **Integration:** Test Team Settings navigation and route parameter forwarding.
- **Finished behavior:** Run typecheck, unit/component tests, and lint after implementation. When simulator access is feasible, use `rn-iso` and Argent to verify navigation, loaded/empty/error states, pagination, refresh, screenshots/accessibility tree, and logs. If authentication is required, use available test-credential environment variables without printing them; otherwise record the simulator path as blocked and use the closest automated verification.

## Rollout, rollback, observability, and risks

- **Rollout:** Ship as a read-only route reached from Team Settings after automated and feasible simulator verification.
- **Rollback:** Remove the Team Settings entry and route while leaving the isolated query/client code unused.
- **Signal:** Monitor `team_members_opened`, `team_members_page_loaded`, normalized request failures, and pagination failures without member-level data.
- **Risk:** Cursor retries or duplicate IDs could duplicate rows; mitigate with same-cursor tests and first-ID-wins deduplication.
- **Risk:** Refresh and pagination errors could replace useful rows; mitigate with explicit stale-row component tests.

## Open questions

- None. The implementation contract and scope are agreed.
