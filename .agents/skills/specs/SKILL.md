---
name: specs
description: Runs a rigorous product-specification interview and writes a complete, implementation-light spec.md with story maps, scenarios, failure behavior, and testable acceptance criteria. Use when the user explicitly invokes /skill:specs to define requirements, multiple user stories, scope, behavior, edge cases, or acceptance criteria before implementation.
model: gpt-5.6-sol
effort: medium
disable-model-invocation: true
---
# Specs
Turn an idea into a complete, implementation-light product spec in `spec.md`.
## Interview contract
Interview the user relentlessly until both sides share the same understanding.
- Ask exactly one question at a time and wait for the answer. The recommendation inside that question must address the same single decision; do not bundle independent rules, defaults, validations, or outcomes into one proposed answer.
- For every question, give a recommended answer or concrete draft, with brief reasoning.
- Resolve prerequisite decisions before dependent ones. Systematically test relevant coverage-ledger branches, including slow states, interruption, concurrency, and accessibility; asking once about a plausible edge case is valid even when the answer is ultimately out of scope. Prioritize branches by user impact and likelihood, frame them as observable product behavior, and stop pursuing them once they are resolved or declared out of scope.
- Find facts in the filesystem, docs, tickets, analytics, product copy, code, tests, or tools instead of asking the user.
- Put product decisions to the user; never silently choose one because it seems obvious.
- Challenge ambiguity, conflicting requirements, hidden assumptions, and untestable language.
- Do not treat silence, partial answers, or moving on as agreement. An answer accepts only what it explicitly resolves, even when your recommendation bundled additional consequences or behavior into the question. Ask narrow follow-ups immediately until every part of that decision is explicit, then introduce the next decision.
- Treat an explicit `out of scope` decision as resolved scope, not as a deferred open question. Record it as a non-goal and move on; do not ask who owns it or continue designing that behavior unless the user identifies a required in-scope consequence.
- Do not write `spec.md` or begin implementation until the user explicitly confirms shared understanding.
## Workflow
1. **Research context**
   - Check for an existing `spec.md`, `CONTEXT.md`, `README.md`, ADRs, roadmap docs, issues, and relevant product evidence.
   - Reuse established terminology and surface conflicts immediately.
2. **Map the experience before interviewing**
   - Identify each actor, entry point, goal, and outcome.
   - Break the capability into distinct user stories. A story is distinct when its actor, trigger, goal, permission, state transition, or outcome differs.
   - For every story, enumerate its normal flow, valid alternatives, blocked paths, recoverable failures, and terminal outcomes.
   - Build a coverage ledger. Mark each relevant area as agreed, pending, or not applicable with a reason.
3. **Interview one decision at a time**
   - State the question, relevant known facts, and the recommended answer.
   - Explain meaningful alternatives or consequences when they exist.
   - Ask the user to accept, modify, or reject the recommendation, then wait.
   - Keep the story map and coverage ledger current; follow every agreed decision into newly opened branches.
4. **Confirm completeness**
   - Recap every story, its scenarios, state changes, assumptions, exclusions, and remaining questions.
   - Check that every in-scope story has observable acceptance criteria for success and relevant non-happy paths.
   - After the recap, explicitly ask two separate confirmation checks in order: first whether anything is missing or incorrect; only after that is resolved, ask whether shared understanding has been reached. Do not treat a generic approval of the recap as answering both checks.
   - If not confirmed, continue interviewing one question at a time.
5. **Write only after confirmation**
   - Write or update `spec.md` in the current working directory.
   - Preserve every genuinely deferred item under `Open questions`, including its owner and the decision point or impact. Before writing, reconcile the final recap against that section so no unresolved decision is omitted or presented as settled. Do not use `Open questions` to avoid resolvable decisions.
## Coverage ledger
Cover what is relevant for **each** story; explicitly mark irrelevant branches and why:
- actor, permission, entry condition, trigger, goal, and completion/exit state
- primary flow and every materially different alternate flow
- inputs, defaults, validation, dependencies, and state changes
- empty, loading, slow, error, offline, interrupted, retry, cancellation, and recovery behavior
- duplicates, conflicts, limits, expired/stale data, concurrent actions, and irreversible actions
- notifications, handoffs, visibility, audit/history, and outcomes for affected actors
- accessibility, privacy, security, compliance, abuse/misuse, and data lifecycle; for stale permissions or lost access, state both the resulting user-visible path and what protected information must not be disclosed
- analytics, success measures, rollout expectations, risks, scope, non-goals, and assumptions
Stay at the product-behavior level. Do not ask the user to choose storage, records, identifiers, architecture, scheduling mechanisms, or other implementation design when the observable behavior can be specified without that choice. When implementation details arise, capture only the user-facing requirement or constraint behind them.
## `spec.md` format
```md
# [Spec title]
## At a glance
**Problem:** [One sentence]
**Goal:** [One sentence]
**Primary users:** [Users]
**Success:** [Observable measure]
**Status:** Agreed
## Why this matters
[Problem, evidence, and desired outcome.]
## Scope and non-goals
- **In scope:** [Capability]
- **Out of scope:** [Non-goal]
## Users, permissions, and needs
- **[User/role]:** [Permission, need, current pain, desired outcome]
## Story map
| ID | Actor | Trigger | Goal | Outcome |
| --- | --- | --- | --- | --- |
| US-1 | [Actor] | [Trigger] | [Goal] | [Observable completion] |
## Detailed stories and scenarios
### US-1: [Story title]
**Story:** As a [user], I want [capability], so that [outcome].
**Preconditions:** [Required state, permissions, or data]
#### Primary scenario
1. [Observable step]
2. [Observable result/state change]
#### Alternate and non-happy scenarios
- **[Condition]:** [Expected behavior, recovery path, and terminal outcome]
#### Acceptance criteria
- Given [context], when [action], then [observable result].
- Given [failure/edge context], when [action], then [observable behavior and recovery].
## Cross-cutting requirements
- **Accessibility:** [Requirement]
- **Privacy/security/compliance:** [Requirement]
- **Data lifecycle:** [Creation, visibility, retention/deletion]
- **Analytics:** [Event or measure and purpose]
## Constraints, assumptions, and risks
- **Constraint:** [Known limitation]
- **Assumption:** [Belief and validation status]
- **Risk:** [Risk and mitigation]
## Open questions
- [Intentionally deferred question, owner, and impact]
```
Write for a smart non-technical reader. Use concrete, observable language. Every in-scope story must stand alone, and no scenario may rely on an unstated happy-path assumption.
