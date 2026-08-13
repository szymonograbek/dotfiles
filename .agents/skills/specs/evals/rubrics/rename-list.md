Evaluate the complete interview transcript and resulting `spec.md`. Judge meaning rather than exact wording.

## Verified context and agreed truth

PocketList calls authenticated customers members. Members create private shopping lists. Each list has a details-screen overflow menu; My Lists shows lists available to the signed-in member. Only owners can change their lists. Sharing, collaboration, history, and administrator actions do not exist. Existing form errors appear beside fields and are announced to screen readers. Analytics cannot contain list names or item contents. Implementation design is out of scope.

The stakeholder's intended decisions are:

- Only a signed-in owner can rename their list, from the list-details overflow menu.
- The editor starts with the current name selected.
- Leading/trailing whitespace is trimmed. Valid length is 1–60 Unicode characters after trimming.
- Duplicate names across the owner's lists are allowed.
- Save is unavailable for unchanged or invalid trimmed names. Blank and over-limit values receive inline explanations.
- Success updates the name everywhere and returns to list details.
- Cancel/dismiss changes nothing. Discarding an edited value requires confirmation; staying preserves the draft.
- Save failure keeps the editor and entered value, explains failure, and offers retry or cancel.
- If the list was deleted or ownership was lost before save, explain that it is unavailable, reveal no inaccessible data, and return to My Lists.
- Rename changes no list content or behavior.
- Sharing, collaboration, history, notifications, and administrator renaming are out of scope.
- Field, validation, discard confirmation, and actions are keyboard/screen-reader usable; errors and disabled states do not rely on color alone.
- Record rename-started, rename-completed, and rename-failed without names or item contents.
- Success is same-session rename completion rate. Its numeric target is the sole unresolved question, owned by Product before rollout.
- Roll out to all signed-in members after internal validation, with no experiment.

The stakeholder deliberately gives a partial first validation answer and rejects unique-name validation. The interviewer must resolve the partial answer immediately and preserve the rejection.

## Scoring

### Interview discipline — 0.35

- Uses established repository facts and terminology without asking the stakeholder to rediscover them. File-inspection timing is verified separately by deterministic trajectory checks.
- Asks exactly one product decision at a time, with a recommendation and brief reasoning.
- Resolves the partial validation answer immediately before changing topics.
- Does not treat rejection, silence, or a partial answer as agreement.
- Systematically tests relevant slow-state, interruption, concurrency, privacy, and accessibility edge cases as observable product behavior. Do not deduct merely because one scoped question establishes that a plausible edge case is out of scope.
- Avoids implementation, architecture, and data-model choices; converges without repeating or continuing branches after they are resolved or declared out of scope.

### Convergence and confirmation — 0.20

- Covers the primary flow and relevant validation, cancellation, failure, stale-access, permission, accessibility, analytics, rollout, and scope decisions.
- Produces an accurate recap distinguishing agreed, out-of-scope, and unresolved items.
- Separately asks whether anything is missing/incorrect, resolves that check, and then asks whether shared understanding is confirmed.
- Does not write `spec.md` before explicit confirmation.

### Final specification — 0.35

- Correctly represents all verified and agreed behavior without inventions or contradictions.
- Uses the required structure, a useful story map, standalone scenarios, and observable acceptance criteria.
- Covers success, unchanged/invalid input, duplicates, discard cancellation, save failure/retry, deleted/inaccessible list, permissions, and absence of unrelated state changes.
- Covers accessibility, privacy-safe analytics, success measurement, rollout, scope, non-goals, assumptions, and risks.
- Keeps only the numeric success target as a genuinely unresolved Product-owned open question.
- Is clear to a smart non-technical reader and implementation-light.

### Grounding and consistency — 0.10

- Transcript, recap, and spec agree.
- Duplicate names remain allowed and rejected recommendations are not presented as agreed.
- No names, item contents, implementation details, numeric target, or unsupported behavior are invented.

A score of 1.0 requires a disciplined interview and complete grounded spec. A polished final document cannot compensate for violating the interview contract.
