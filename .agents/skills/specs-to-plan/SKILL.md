---
name: specs-to-plan
description: Guides an implementation-planning session from an existing spec, choosing architecture, boundaries, APIs, and rollout approach without changing code. Use when the user explicitly invokes /skill:specs-to-plan to turn spec.md or requirements into an implementation plan.
disable-model-invocation: true
---

# Specs to Plan
## What to do

Turn `spec.md` or stated requirements into a clear implementation plan, but do not enact it.

Interview the user relentlessly until there is shared understanding. Walk down the design tree one branch at a time, resolving dependencies between decisions in order.

Ask exactly one question at a time. For each question, provide your recommended answer and why. Wait for the user's answer before continuing.

If a fact can be found by exploring the codebase, docs, tests, or config, look it up instead of asking. Decisions belong to the user: present each decision clearly and wait for confirmation.

Do not edit application code, create commits, run migrations, or enact the plan until the user explicitly confirms the plan is ready and asks you to implement it.

## Workflow

1. **Load the spec and context**
   - Read local `spec.md` first if it exists.
   - Inspect relevant docs, code, tests, APIs, data models, and existing conventions.
   - Identify current architecture, naming, ownership, and extension points.

2. **Map decisions**
   - Convert the spec into implementation decisions: architecture, data model, API shape, UI flow, error handling, observability, testing, rollout, and migration.
   - Order decisions so prerequisites come first.
   - Skip irrelevant categories for small changes.

3. **Interview one decision at a time**
   - State the decision to make.
   - Summarize relevant facts from the codebase.
   - Give the recommended option.
   - Mention meaningful alternatives and trade-offs.
   - Ask the user to accept, modify, or reject the recommendation.

4. **Write the plan**
   - Save the agreed plan as `plan.md` in the current working directory.
   - If `plan.md` already exists, update it in place.
   - Keep unresolved decisions in `Open questions`.

## Decision quality bar

Prefer plans that are simple, maintainable, type-safe, and aligned with existing conventions. Avoid new abstractions unless they clarify ownership or protect a real boundary. Challenge shallow designs and resolve terminology conflicts first.

## `plan.md` format

```md
# [Plan title]

## At a glance
**Spec:** [spec.md or source]
**Goal:** [One sentence]
**Recommended approach:** [One sentence]
**Status:** Draft

## Relevant context

- [Existing code, API, data model, or convention that matters]

## Decisions
### [Decision name]

**Decision:** [Chosen option]
**Why:** [Reasoning and trade-offs]
**Alternatives considered:** [Alternative and why not]

## Proposed architecture

[Readable explanation of the main boundaries, responsibilities, and data flow.]

## API and data model changes

- [Endpoint, type, event, schema, or interface change]

## Implementation steps

1. [Small coherent step]
2. [Small coherent step]

## Testing and verification

- [Unit, integration, UI, migration, analytics, Argent simulator check, or manual check]
- For mobile UI/user-flow work, identify which acceptance criteria are simulator-verifiable with Argent after implementation. Argent is feasible only when the simulator can reach the target state; if auth is required, note whether test credentials such as `TEST_USER`, `TEST_EMAIL`, or `TEST_PASSWORD` are expected to be available in the environment. If Argent cannot verify a criterion, state why and choose another verification method.

## Rollout and risks

- **Rollout:** [How this ships safely]
- **Risk:** [Risk and mitigation]

## Open questions

- [Unresolved decision]
```

## Readability rules

Write for engineers who will implement later. Be concrete, ordered, and easy to scan. Separate facts from decisions. Do not hide uncertainty. Do not start implementation unless explicitly asked after the plan is agreed.
