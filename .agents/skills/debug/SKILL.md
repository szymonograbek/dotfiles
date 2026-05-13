---
name: debug
description: Investigate bugs/issues to find concrete, evidence-backed reproduction steps without fixing them. Use when the user reports a bug, failure, regression, flaky behavior, stack trace, unexpected output, or asks to debug/reproduce an issue.
---

# Debug

## Purpose

Help the user reproduce and understand an issue. Do not fix, patch, refactor, or propose fixes unless the user explicitly asks.

## Rules

- Ground every claim in inspected source code, docs, logs, GitHub issues, or web search results.
- Prefer concrete evidence over theories. Label uncertainty clearly.
- Never jump straight to implementation changes.
- Do not propose fixes, mitigations, or code edits unless explicitly requested.
- The primary deliverable is reproducibility: exact steps, inputs, environment, observed behavior, and evidence.

## Workflow

1. **Capture the report**
   - Record symptoms, expected vs actual behavior, errors, stack traces, versions, environment, inputs, and timing.
   - If key details are missing and not retrievable, ask only the minimal clarifying question.

2. **Inspect evidence**
   - Search the repo for relevant code paths, error messages, config, tests, and docs.
   - Use web/code search for third-party behavior, upstream docs, and GitHub issues when dependencies or external systems may be involved.
   - Cite files, commands, docs, URLs, or issue references used as evidence.

3. **Find the suspected source**
   - Identify the smallest code path or state transition that explains the symptom.
   - Separate confirmed facts from hypotheses.
   - Avoid fix language; focus on why the behavior is reachable.

4. **Reproduce**
   - Try to reproduce locally when safe and feasible.
   - Capture exact commands, inputs, fixtures, env vars, and outputs.
   - If local reproduction is not possible, design a manual reproduction path.

5. **Instrument when needed**
   - If more runtime evidence is needed, suggest temporary logs with a `[DEBUGGER]` prefix so the user can filter them.
   - Keep logs targeted to branch decisions, input shape, identifiers, state transitions, and caught errors.
   - Ask the user to run the scenario and paste back only the `[DEBUGGER]` lines plus the error/output.

## Output format

Use this structure unless the user requests otherwise:

~~~md
## Findings
- [Evidence-backed facts]

## Suspected source
- [File/function/code path and why it is implicated]

## Reproduction steps
1. [Exact step]
2. [Exact step]

## Expected vs actual
- Expected: ...
- Actual: ...

## Evidence
- `path:line` / command output / doc or issue URL

## If reproduction is still unclear
Add these temporary logs:
```[language]
console.log("[DEBUGGER] ...", ...)
```
Then run:
```sh
...
```
Paste back the `[DEBUGGER]` lines and the final error/output.
~~~

## Manual reproduction log guidelines

Good `[DEBUGGER]` logs answer:

- Did this code path run?
- What input shape or key IDs reached it?
- Which branch was taken?
- What external response/status was received?
- What state changed immediately before the failure?

Avoid logging secrets, tokens, full PII, or huge payloads. Redact sensitive values.
