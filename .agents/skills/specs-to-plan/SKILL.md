---
name: specs-to-plan
description: Runs a rigorous implementation-design interview from an existing spec, resolving architecture, boundaries, APIs, delivery, and verification before writing plan.md. Use when the user explicitly invokes /skill:specs-to-plan to turn spec.md or requirements into an agreed implementation plan.
model: gpt-5.6-sol
effort: medium
disable-model-invocation: true
---

# Specs to Plan
Turn `spec.md` or stated requirements into an implementation plan without enacting it.
## Interview contract

Interview the user relentlessly until both sides share the same understanding.

- Ask exactly one question at a time and wait for the answer.
- For every question, recommend an answer and briefly explain why.
- Resolve prerequisite decisions before dependent ones. Follow each answer into its relevant branches.
- Find facts in code, docs, tests, configuration, history, and tools instead of asking the user.
- Put implementation decisions to the user; never silently choose one because it seems obvious or conventional.
- Challenge ambiguity, conflicting requirements, hidden assumptions, unsafe shortcuts, and missing failure behavior.
- Do not treat silence, partial answers, or moving on as agreement.
- Do not write `plan.md`, edit application code, migrate data, commit, or enact the plan until the user explicitly confirms shared understanding.

## Workflow

1. **Research context**
   - Read local `spec.md` first when present.
   - Inspect relevant docs, code, tests, APIs, schemas, config, and history.
   - Identify existing architecture, naming, ownership, extension points, constraints, and unresolved spec gaps.

2. **Build the decision tree**
   - Inventory known facts, assumptions, decisions, dependencies, risks, and unanswered questions.
   - Cover every relevant branch below; explicitly mark irrelevant branches and why.
   - Order decisions by dependency rather than by implementation sequence.

3. **Interview one decision at a time**
   - State the decision and summarize relevant evidence.
   - Recommend one option with trade-offs and mention meaningful alternatives.
   - Ask the user to accept, modify, or reject it, then wait.
   - Record the agreement and any new branches opened by the answer.

4. **Confirm completeness**
   - Recap the architecture, data flow, API changes, delivery sequence, verification, rollout, risks, assumptions, and exclusions.
   - Ask whether anything is missing and whether shared understanding has been reached.
   - If not confirmed, continue interviewing one decision at a time.

5. **Write only after confirmation**
   - Write or update `plan.md` in the current working directory.
   - Keep only genuinely deferred decisions in `Open questions`; do not use that section to avoid resolvable choices.
   - Stop after writing the plan unless the user separately asks to implement it.

## Decision tree

Cover what is relevant:

- requirement interpretation, scope boundaries, terminology, and acceptance-criterion mapping
- affected components, ownership, module boundaries, reuse, and dependency direction
- end-to-end control/data flow, state model, invariants, concurrency, and idempotency
- APIs, events, types, schemas, validation, compatibility, versioning, and data lifecycle
- UI states, accessibility, permissions, errors, retries, recovery, offline behavior, and limits
- security, privacy, compliance, abuse cases, secrets, and authorization
- performance, scalability, reliability, observability, analytics, and operational support
- migrations, backfills, feature flags, rollout, rollback, compatibility windows, and cleanup
- unit/integration/UI/e2e verification, fixtures, failure tests, manual checks, and acceptance coverage
- implementation order, independently shippable steps, dependencies, risks, and documentation

Prefer the simplest type-safe design aligned with existing conventions. Avoid abstractions without clear ownership or a real protected boundary.

## `plan.md` format

```md
# [Plan title]
## At a glance
**Spec:** [Source]
**Goal:** [One sentence]
**Approach:** [One sentence]
**Status:** Agreed
## Relevant context
- **Fact:** [Evidence from the repository]
## Decisions
### [Decision]
**Choice:** [Agreed option]
**Why:** [Reasoning and trade-offs]
**Alternatives:** [Rejected option and why]
## Proposed architecture and data flow
[Boundaries, responsibilities, invariants, and end-to-end flow.]
## API, schema, and UI changes
- [Concrete interface or behavior change]
## Implementation steps
1. [Small coherent, ordered step]
## Testing and acceptance coverage
- **[Acceptance criterion]:** [Verification method]
## Rollout, rollback, observability, and risks
- **Rollout:** [Safe release path]
- **Rollback:** [Recovery path]
- **Signal:** [Metric/log/alert]
- **Risk:** [Risk and mitigation]
## Open questions
- [Intentionally deferred decision, owner, and impact]
```

For mobile UI flows, state which criteria Argent can verify and what reachable simulator state or test credentials are required. If it cannot verify a criterion, explain why and name another method.
