---
description: Review user-specified changes with seven focused subagents
argument-hint: "<review scope>"
---

Review the changes specified by the user: `$ARGUMENTS`.

Run exactly 7 subagents in parallel using `run_subagent` with an `agents` array. Each subagent must review the full scope from `$ARGUMENTS`, but only report findings for its assigned lens. Do not tell subagents to use any specific skill, and especially do not tell them to use `code-review`. Set `includeSkills: true` for every subagent so they can load relevant operational skills such as `jj` when needed.

Subagents:

1. Correctness / contract reviewer — `thinkingLevel: "medium"`
   - Look for broken behavior, regressions, changed contracts, missing call-site updates, invalid assumptions, and producer/consumer mismatches.

2. Async / lifecycle / state consistency reviewer — `thinkingLevel: "medium"`
   - Look for race conditions, stale data, missing cleanup, subscription/event issues, cache/persistence inconsistencies, visibility/focus bugs, and state replacement/merge hazards.

3. Edge cases / error handling / compatibility reviewer — `thinkingLevel: "medium"`
   - Look for empty, null, partial, delayed, duplicated, or failed data; retry/error-state gaps; degraded UI/API states; and backward/forward compatibility issues.

4. Security / privacy / permissions reviewer — `thinkingLevel: "medium"`
   - Look for auth/authorization bugs, permission bypasses, data leaks, unsafe logging, exposed secrets, PII handling issues, and privacy regressions.

5. Performance / resource reviewer — `thinkingLevel: "medium"`
   - Look for unnecessary re-renders, expensive work, N+1 behavior, avoidable I/O, startup/runtime cost, memory/resource leaks, and missing cleanup of costly resources.

6. Established patterns / consistency reviewer — `thinkingLevel: "medium"`
   - Look for inconsistencies with nearby code and established repo conventions: API shapes, naming, file organization, error handling style, state-management patterns, test patterns, styling/layout conventions, dependency usage, and existing abstractions. Flag deviations only when they create real maintenance cost, confusion, or likely bugs.

7. Architecture / maintainability reviewer — `thinkingLevel: "high"`
   - Review the full scope through an architecture and maintainability lens. Do not focus on small style issues. Look for misplaced responsibilities, leaky abstractions, duplicated domain knowledge, unclear ownership, shallow/pass-through modules, overexposed APIs, temporal decomposition, inconsistent naming/domain concepts, testability regressions, and designs that make invalid states possible. Also flag dead code, unreachable branches, duplication, or convention drift when they indicate maintainability risk.

Each subagent task must be self-contained and include:
- The full review scope from `$ARGUMENTS`.
- Its assigned agent number, lens, and thinking level.
- Instructions to label every finding with its agent number and lens.
- Instructions to inspect the diff plus necessary surrounding code before reporting.
- Instructions to report only evidence-backed findings, with file/function references.
- Instructions to say "No findings for this lens" if it finds no evidence-backed issue.

Allow at least `read` and `bash`; include other tools only if the scope requires them.

After all subagents finish, synthesize their results into one concise review. Deduplicate overlapping findings. Keep only evidence-backed issues. Drop speculative findings or convert them into open questions. Preserve which agent or agents flagged each retained finding.

Final response template:

## Review summary

One short paragraph summarizing the reviewed scope and overall risk. If no issues were found, say so here.

## Findings

List findings in priority order. Use stable numbering.

1. `High|Medium|Low|Nit: <short title>`
   - `Flagged by:` `Agent <n> — <lens>`; include multiple agents if more than one flagged it.
   - `Evidence:` concrete file/path/function, code path, or command output.
   - `Impact:` what breaks, degrades, leaks, or becomes harder to maintain.
   - `Introduced by this change:` `Yes|No, pre-existing|Unclear`
   - `Suggested fix:` concise remediation when clear.

If there are no findings, write: `No evidence-backed findings.`

## Open questions

Bullets for unresolved questions that affect correctness or review confidence. Omit this section if none.

## Subagent coverage

One bullet per agent:
- `Agent <n> — <Lens>`: `<findings count or "no findings">`
