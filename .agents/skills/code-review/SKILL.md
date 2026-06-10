---
name: code-review
description: Reviews code changes in phases, from change inventory through intent, context gathering, evidence-backed findings, and prioritized output. Use when the user asks for a code review, review of staged changes, review of a commit/diff/PR scope, or asks to find regressions, bugs, edge cases, naming, dead code, or architecture issues in changes.
---

# Code Review

## Quick start

Review the user-provided scope. If no scope is given, review staged changes. If nothing is staged, review the last commit.

Always check for `.jj/` before version-control commands. If present, prefer `jj`; otherwise use `git`.

## Scope selection

1. If the user gives an explicit scope, use it exactly:
   - file paths, commit range, branch comparison, PR diff, patch, or described area.
2. If no scope is given:
   - In a jj repo: inspect staged/bookmarked workflow as appropriate; if no relevant pending change is available, review the parent-vs-current change.
   - In a git repo: review staged changes with `git diff --staged --stat` and `git diff --staged`.
3. If no staged git changes exist, review the last commit with `git show --stat --oneline HEAD` and `git show HEAD`.

## Review phases

### 1. Change inventory

Identify what changed before judging it:

- Files changed.
- Lines added/removed per file.
- Kind of change per file: production code, tests, config, docs, migrations, generated files.
- Changed responsibilities per file: data loading, state derivation, rendering, user actions, external side effects, lifecycle, persistence/cache, events/subscriptions, formatting, validation.
- Any suspicious omissions, such as behavior changes without tests or API changes without call-site updates.

Do not begin final output until the diff and each changed production responsibility have been inspected at least once. For non-trivial production changes, explicitly audit each present responsibility type: data loading, rendering, user actions, external mutations, event/subscription handling, cache/persistence, and lifecycle/visibility. Findings in one type do not replace the audit of the others.

### 2. Intent

Infer the exact intent from the diff and nearby context:

- What behavior, API, data model, UI, or workflow changed?
- What problem does the change appear to solve?
- What assumptions does the change introduce or remove?
- If intent cannot be inferred, state the uncertainty and continue from observable facts.

### 3. Context gathering

Gather enough surrounding context to understand what, why, and how:

- For changed functions/types/modules, inspect callers, implementations, tests, and related configuration.
- For changed components, inspect props, consumers, state flow, styling/layout constraints, and tests/stories if present.
- For data/schema/API changes, inspect producers, consumers, serializers/parsers, migrations, validation, and backward compatibility.
- For behavior changes, inspect existing tests and similar code paths.
- Prefer targeted searches and reads. Do not stop at the diff when impact depends on usage elsewhere.
- Keep a private candidate list while reviewing. Do not finalize after the first valid issue; continue until every changed responsibility has been checked.

### 4. Contract tracing

For each changed responsibility, identify the mechanism it relies on and verify its contract end-to-end:

- What produces this state, data, event, or side effect?
- What consumes it?
- What causes consumers to update?
- What owns cleanup, lifetime, and visibility/focus constraints?
- What is the source of truth if multiple copies or derivations exist?
- What happens when data arrives late, twice, out of order, stale, partially, or not at all?
- What user-visible state exists before, during, and after the operation?
- What assumptions does the new code make that callers, types, tests, or runtime checks do not enforce?

Prefer findings where a contract is broken, ambiguous, duplicated, or unenforced.

Do this contract tracing separately for each changed data path, user interaction, and side effect. For each one, compare the previous contract to the new contract and check whether all producers, consumers, lifecycle owners, and user states were updated consistently.

For every new or changed side effect, identify: trigger, target identity, required preconditions, lifecycle/visibility/focus guard, retry/error behavior, and what happens if the triggering data is stale or superseded before the effect completes.

For every new or changed state read, identify: where the value is produced, whether it is available synchronously or later, what mechanism notifies the consumer of changes, and what the consumer shows before the first value arrives.

For every new or changed state replacement or merge, identify: old state, incoming state, source freshness, pending local changes, ordering/identity guarantees, and whether replacement can discard newer or user-visible data.

### 5. Review dimensions

Look for concrete issues in:

- Correctness bugs and regressions.
- Edge cases and error handling.
- Backward/forward compatibility.
- Concurrency, async ordering, caching, lifecycle, and state consistency.
- Security, privacy, permissions, and data leakage.
- Performance or resource leaks.
- Test gaps that hide likely regressions.
- Unclear or wrong naming.
- Inconsistencies with nearby code, established conventions, or codebase patterns.
- Dead code, unreachable branches, duplicated logic.
- Architectural boundary violations or misplaced responsibilities.

### 6. Final sweep before output

Before writing the final answer, make one explicit pass over the private candidate list and the changed responsibilities:

- Merge duplicates.
- Drop speculative or weak candidates.
- Keep concrete lower-severity findings if they reveal a real broken contract, inconsistency, missing state, or maintainability regression.
- If only one finding remains for a non-trivial multi-file change, re-check the other changed responsibilities before finalizing; one real issue often coexists with smaller inconsistencies or lifecycle/state regressions.
- Check that the final list is not tunnel-visioned on only one file or one kind of issue when the change spans multiple responsibilities.

### 7. Ground uncertain claims

Do not report speculative findings as facts.

If something is only possibly broken:

- Gather evidence from code, tests, docs, or command output.
- Explain the execution path or data flow that makes it fail.
- If evidence remains insufficient, either omit it or label it as a question/risk, not a finding.

Flag issues that are likely pre-existing separately from regressions introduced by the reviewed change.

### 8. Output format

Return all useful findings found in the reviewed scope, not just the first or most severe ones. Include concrete Medium, Low, and Nit findings when they expose real broken contracts, inconsistencies, missing states, or maintainability regressions. If no issues are found, say so briefly and mention the reviewed scope.

Use this format, with a stable finding number for reference:

1. `High|Medium|Low|Nit: <short title>`
   - `Evidence:` concrete file/path/function or observed behavior.
   - `Impact:` what breaks or degrades.
   - `Introduced by this change:` `Yes|No, pre-existing|Unclear`.
   - `Suggested fix:` concise remediation when clear.

Order findings by priority. Use `Nit` only for low-risk polish, consistency, or readability issues. Keep each finding referenceable by its number.
