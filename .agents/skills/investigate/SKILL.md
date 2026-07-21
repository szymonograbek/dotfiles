---
name: investigate
description: Investigates, reproduces, root-causes, fixes, and verifies React Native application issues end to end. Use when the user reports a React Native bug, regression, runtime failure, broken UI flow, or asks to diagnose and fix an issue using rn-iso and Argent.
model: gpt-5.6-sol
effort: medium
disable-model-invocation: true
---

# Investigate

## Goal

Resolve the verified root cause of a React Native issue. Do not stop at diagnosis or mask the symptom.

## Rules

- Ground conclusions in source, targeted `[debug]` logs, and a device reproduction.
- Ask one minimal question only when the reported behavior cannot be inferred or reproduced.
- Do not log secrets, tokens, full PII, or unbounded payloads.
- Keep instrumentation narrow: inputs, IDs, branch decisions, state transitions, responses, and errors.
- Use the exact prefix `[debug]` for temporary logs.
- Make the smallest maintainable root-cause fix. Do not add symptom-only workarounds.
- Do not commit, create a PR, or continue with unrelated work.

## Workflow

1. **Understand the issue**
   - Capture the affected screen/flow, expected and actual behavior, errors, environment, inputs, and timing.
   - State the initial reproduction target before changing code.

2. **Read the code statically**
   - Trace the relevant UI, state, hooks, services, navigation, and API boundaries.
   - Identify the smallest plausible failing state transition or invariant violation.
   - Separate facts from hypotheses.

3. **Instrument the suspected path**
   - Add focused `console.log("[debug] ...", data)` calls around the suspected inputs, branches, transitions, and failures.
   - Include enough stable identifiers to correlate the flow without exposing sensitive data.

4. **Reproduce on a device**
   - Read and follow the `rn-iso` skill to target the correct isolated Metro server and simulator/emulator.
   - Read and follow the appropriate Argent setup and interaction skills before device interaction.
   - Run the reported flow with rn-iso and Argent. Record exact steps and relevant `[debug]` output.
   - If it does not reproduce, vary only evidence-based conditions and document the result.

5. **Fix the root cause**
   - Confirm the observed logs and code path explain the failure.
   - Change the responsible boundary, state model, or transition—not its downstream symptom.
   - Add or update a focused automated test when the project has a suitable test harness.

6. **Verify thoroughly**
   - Re-run the original device reproduction with rn-iso and Argent and confirm the `[debug]` trace takes the corrected path.
   - Exercise relevant edge cases: empty/loading/error states, repeated actions, back/foreground or navigation changes, and boundary inputs relevant to the defect.
   - Run the narrowest relevant automated checks.
   - Remove temporary `[debug]` logs unless the user requests that they remain. Do not remove pre-existing logs.

7. **Stop and report**
   - Do not continue into cleanup, commits, PRs, or adjacent improvements.
   - Provide only this short summary:

```md
## Issue
[Root cause]

## Reproduction
1. [Exact rn-iso/Argent steps]
2. [...]

## Fix
[What changed and why it addresses the root cause]

## Verification
- [Original scenario]
- [Edge cases]
- [Automated checks and relevant `[debug]` evidence]
```
