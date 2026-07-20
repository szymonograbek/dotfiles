---
name: plan-to-tickets
description: Breaks an agreed implementation plan into clear, reviewable engineering tickets saved as local Markdown files. Use when the user explicitly invokes /skill:plan-to-tickets to turn plan.md or an implementation plan into tickets under tickets/<number>.md.
model: gpt-5.6-terra
effort: low
disable-model-invocation: true
---

# Plan to Tickets
## What to do

Turn `plan.md` or a stated implementation plan into small, ordered tickets in `tickets/`.

Do not implement the tickets. Do not create Jira/GitHub issues unless the user explicitly asks. The output is local Markdown only. Each ticket must state that it should be implemented in its own separate commit, stacked in ticket order on top of the prior ticket's commit.

If a fact can be found in `plan.md`, `spec.md`, docs, code, tests, or config, look it up instead of asking. Ask only when a decision materially changes ticket boundaries or sequencing.

When asking, ask one question at a time and include your recommended answer.

## Workflow

1. **Load context**
   - Read `plan.md` first if it exists.
   - Read `spec.md` if useful for goals, user stories, or acceptance criteria.
   - Inspect relevant code only when needed to size or sequence tickets.

2. **Choose ticket boundaries**
   - Prefer tickets that are independently reviewable and testable.
   - Keep each ticket focused on one coherent change.
   - Order tickets by dependency: foundations, behavior, integration, cleanup, then post-implementation verification.
   - Always create a final separate post-implementation verification ticket. It should run after implementation tickets and verify the finished behavior against the acceptance criteria.
   - Avoid tickets that are only vague chores, unless they unblock later work or perform final verification.

3. **Create local ticket files**
   - Create `tickets/` in the current working directory if needed.
   - Write one ticket per file: `tickets/1.md`, `tickets/2.md`, `tickets/3.md`, etc.
   - If ticket files already exist, ask before overwriting unless the user explicitly asked to regenerate.

4. **Summarize**
   - List created ticket files in order.
   - Mention dependencies and any unresolved questions.

## Ticket quality bar

Each ticket should be understandable without rereading the whole plan, but should not duplicate excessive context. Include enough detail for an engineer to implement and verify it later.

For mobile UI or user-flow work, the final verification ticket should include simulator verification using the `rn-iso` skill alongside Argent when feasible. Use `rn-iso` to manage the isolated React Native environment and discover the correct device target, then use Argent for UI interaction and verification. Verification is feasible only when the simulator can reach the target state without unavailable credentials, privileged accounts, real calls/SMS, payments, production-only services, or external manual setup. If auth is required, instruct the implementer to check environment variables such as `TEST_USER`, `TEST_EMAIL`, and `TEST_PASSWORD`; use them without printing values if present, and mark Argent verification as blocked if absent. Never invent credentials, request production credentials, or expose credential values.

Prefer vertical slices when possible. Use horizontal/foundation tickets only when they reduce risk or unblock multiple later tickets.

## `tickets/<number>.md` format

```md
# [Ticket title]

## Goal

[One or two sentences describing the outcome of this ticket.]

## Context

- [Relevant fact from plan.md, spec.md, or codebase]

## Commit guidance

Implement this ticket in its own separate commit, stacked on top of the previous ticket's commit unless this is the first ticket.

## Scope

### In scope

- [Work included]

### Out of scope

- [Work intentionally deferred]

## Implementation notes

- [Important architecture, API, data model, or sequencing note]

## Acceptance criteria

- Given [context], when [action], then [observable result].

## Verification

- [Test, manual check, logging check, migration check, build command, or `rn-iso` + Argent simulator check]
- If this is the final post-implementation verification ticket, verify the finished acceptance criteria after all implementation tickets are complete.
- If mobile UI/user-flow behavior is simulator-reachable, load and follow the `rn-iso` skill to manage the isolated environment and discover the correct device, then use Argent to launch the app, navigate the relevant flow, inspect UI state with screenshot/accessibility/component tree, and check logs or screenshot diffs when relevant.
- If auth is required, check for `TEST_USER`, `TEST_EMAIL`, and/or `TEST_PASSWORD` in the environment. If present, use them without printing their values. If absent, do not guess credentials; document that Argent verification is blocked by missing test credentials and provide the closest manual/backend verification path.

## Dependencies

- [Prior ticket number or external dependency]

## Risks and follow-ups

- [Risk, mitigation, or follow-up]
```

## Numbering rules

Use consecutive numbers starting at `1.md`. If updating existing tickets, preserve numbers when possible and only renumber when the user agrees.

## Readability rules

Write for engineers who will pick up the work later. Use concrete titles, short sections, and observable acceptance criteria. Separate required work from optional follow-ups. Do not start implementation.
