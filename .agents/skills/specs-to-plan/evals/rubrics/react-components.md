Evaluate the implementation-design interview and resulting `plan.md`. The purpose is to test whether the planner independently recognizes coherent React state ownership and event/effect boundaries from requirements and repository evidence. Do not reward mechanical mention of a particular hook. Judge whether the proposed model prevents invalid states, follows the established server-state abstraction, and gives each transition a clear owner.

## Verified requirements and repository evidence

- The screen loads orders for an `accountId` and selected `OrderFilter` (`all`, `open`, or `completed`).
- Existing rows stay visible while a different filter is pending. An initial failure, including failure of an uncached filter, replaces the screen; a background refetch failure for a filter with cached data retains rows. Empty appears only after successful empty data.
- Obsolete requests after account/filter changes must not replace current data. Retry repeats the current request.
- `getOrders(accountId, filter, signal)` already accepts cancellation and returns typed orders.
- `orderQueryKeys.list(accountId, filter)` already describes complete request identity.
- TanStack Query 5 is installed. The adjacent `InvoiceListScreen` uses a complete query key, passes the query signal to its API, retains previous data, derives initial/background presentations from one query result, and retries through `refetch`.
- The current order screen manually stores filter, rows, loading, error, and loaded status. It starts requests and clears errors through effects, creates an unowned abort controller, and permits stale requests and contradictory render-state combinations.
- No global store, pagination, persistence, API change, analytics, or generalized async framework is required.

## Strong target design

The most repository-aligned design keeps selected filter as local UI state and lets one TanStack query own server data and request lifecycle:

- query identity includes account and filter;
- query execution forwards its cancellation signal;
- previous successful rows remain available while the next identity fetches; an uncached identity that fails may then show its no-data error, while failed background refetches retain that identity's cached rows;
- loading, background refresh, initial/uncached error, cached-data refresh error, successful empty, and populated states are derived from the coherent query result and data presence;
- retry refetches the current query, filter events only select a filter, and no component effect coordinates requests or clears mirrored error state;
- row navigation/accessibility remains unchanged.

Equivalent naming and query option syntax are valid. A manually managed reducer/state-machine design may receive substantial credit if it models a discriminated request lifecycle with exhaustive legal transitions, owns cancellation and obsolete-result suppression, derives rendering without duplicated facts, and keeps user-caused work in event transitions. It should still be marked weaker than using the established query abstraction unless repository evidence justifies duplication.

Do not interpret this as “effects are always bad” or “every component needs a reducer.” Effects are suitable for synchronizing React with an external system when that synchronization is not already owned by a data/query boundary or a user event. The core standard is coherent ownership and legal state transitions, not hook preference.

## Recommendation quality score — 0.00 to 1.00

Score each dimension from the planner's first substantive recommendation before engineer correction. Later correction improves the plan score but does not erase weak independent judgment.

### State model and ownership — 0.30

- Independently identifies request data/status/error as one server-state lifecycle owned by the established query boundary, while filter remains local user-selection state.
- Rendering is derived from coherent state/data presence; impossible combinations are not represented as independently writable facts.
- Penalize parallel loading/error/data/loaded fields, copied query state, boolean proliferation, or an unnecessary global/controller abstraction.

### Transition and effect boundaries — 0.25

- Independently assigns filter selection and retry to user-event handlers/query operations, and request execution to query identity rather than effect orchestration.
- Explains effects by synchronization responsibility rather than banning them categorically.
- Penalize effects that mirror state, clear related state, or sequence event-caused work; also penalize dogmatic “never use effects” claims.

### Async identity, cancellation, and stale safety — 0.20

- Includes both account and filter in query identity and forwards cancellation so obsolete responses cannot publish as current.
- Penalize missing identity inputs, unowned controllers, stale closure risks, or redundant request-ID machinery layered over the query library.

### UI semantics and continuity — 0.15

- Distinguishes initial or uncached-filter loading/error from background refresh/error, retains prior rows while a new filter is pending and cached rows during failed background refetch, and shows empty only after successful empty data.
- Preserves accessibility and navigation behavior.

### Simplicity and repository fit — 0.10

- Reuses inspected query/API/key conventions and avoids speculative reusable machinery or unrelated refactors.

A first recommendation that merely names the right library without also explaining coherent state ownership, the relevant legal visual states, transition/event ownership, and stale-work handling is incomplete and must score below 0.88. A recommendation score below 0.88 fails even if the engineer later corrects the plan. Narrow implementation details may remain for follow-up when the initial architecture already makes their ownership and required behavior clear.

## Final plan quality score — 0.00 to 1.00

### Complete agreed design — 0.45

- Makes ownership, query identity, cancellation, retained data, derived render semantics, retry/filter transitions, component responsibilities, and preserved behavior explicit.
- States why effects or additional state machinery are unnecessary here without turning that local decision into a universal rule.
- Rejected contradictory or duplicated-state designs do not reappear.

### Verification and acceptance mapping — 0.25

- Covers initial loading/success/error/retry, filter/API/key behavior, retained rows while a new filter is pending, uncached-filter failure, cached-data refresh failure and current retry, successful empty, stale account/filter responses and cancellation, accessibility labels, and row navigation.

### Sequencing, rollout, and risks — 0.20

- Steps are dependency ordered and focused. Normal release and practical rollback are described.
- Stale response, cache collision, and contradictory visual-state risks have concrete mitigations.

### Grounding and plan format — 0.10

- Uses the inspected repository conventions and required specs-to-plan structure.
- Invents no product behavior and leaves no resolvable implementation decisions open.

## Output scoring

Return recommendation and plan scores independently. Compute `overallScore` as their arithmetic mean. Feedback must distinguish first-recommendation defects from final-plan defects and evaluate principles rather than exact hook vocabulary.
