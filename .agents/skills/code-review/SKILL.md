---
name: code-review
description: Perform grounded, broad code reviews that avoid tunnel vision and low-value findings. Use when asked to review code, changes, diffs, staged/unstaged work, branches, pull requests, or architecture impact of a change.
---

# Code Review

## Review target precedence

Review the first available target, in order:

1. Explicit user request or supplied diff/PR/files.
2. Current staged changes.
3. Current unstaged changes.
4. Current branch changes: commits/diff between this branch and its base.

Before any VCS command, check whether `.jj/` exists. If yes, use `jj` workflows; otherwise use `git`.

## Review stance

- It is valid to return no findings when the code is sound.
- Do not manufacture issues to fill the review.
- Prefer high-signal findings over exhaustive commentary.
- Assign each finding a stable numeric ID (`1`, `2`, `3`, ...) so the user can reference it later.
- Mark small style or polish issues with `Nit:`.
- Avoid tunnel vision: zoom out from the edited lines and inspect nearby callers, domain models, invariants, tests, and existing codebase patterns.
- Review adversarially: construct concrete timelines/counterexamples for async, UI, event-driven, and external-tool integrations.
- For operations that affect an external target (pane, tab, window, session, file, user, request), verify the target identity is captured at the right boundary and not re-read from mutable ambient state after focus/context can change.
- Ground every claim in inspected code, documentation, tests, or command output.
- If a finding is a pre-existing bug rather than introduced by the reviewed change, flag it explicitly as `Pre-existing:` and explain why it is still relevant to this review.
- Never say a library/API “probably” behaves a certain way. Check docs, installed types/source, tests, or a minimal local reproduction first; otherwise omit the claim or state the uncertainty as a question.

## Review categories

Use these lenses, matching global engineering standards:

- Correctness: bugs, broken edge cases, invalid assumptions, data loss, races, error handling, stale/global mutable context, wrong-target side effects.
- Type safety: `any`, unsafe assertions, non-null assertions, invalid boundary parsing, impossible states that are representable.
- Domain model: unclear ADTs/discriminated unions, duplicated domain knowledge, illegal states, weak names.
- Architecture: change fit with existing boundaries, shallow modules, pass-through APIs, special-general mixtures, overexposed interfaces, temporal decomposition.
- Maintainability: duplication, unclear code, needless abstraction, comments that repeat implementation, inconsistent repo conventions.
- Dead code: unused exports, unreachable branches, obsolete helpers, stale feature flags, redundant compatibility paths, and code made unused by the change.
- Tests: missing or weakened coverage for changed behavior; tests that assert implementation instead of behavior.
- Security/privacy: secret leakage, authz/authn mistakes, unsafe inputs, sensitive data exposure.
- Performance/reliability: avoid only when materially relevant; ground with code path or expected scale.

## Workflow

1. Identify the review target from precedence above.
2. Read enough context around the diff to understand intent and integration points.
3. Inspect related modules/callers/tests when a finding depends on broader behavior.
4. Ask “what could change between trigger and effect?” for async/evented code: focus, cwd, session, active tab, auth, environment, request/user identity, timers, process lifetime.
5. Verify suspicious API/library behavior before flagging it.
6. Run lightweight validation when useful and safe: typecheck, targeted tests, lint, or build.
7. Produce only actionable findings.

## Output format

If there are findings, list them by severity:

```md
- [ID] [Severity] path:line — concise title
  Evidence: what was inspected or verified.
  Impact: why this matters.
  Suggestion: minimal fix direction.
```

Use severities: `Critical`, `High`, `Medium`, `Low`, `Nit`. Prefix the title with `Pre-existing:` when the issue predates the reviewed change.

If no findings:

```md
No findings.
Checked: <target and key verification/context inspected>.
```

Keep the final answer concise. Do not include a full diff summary unless asked.
