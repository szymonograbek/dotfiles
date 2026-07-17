---
name: specs
description: Runs a rigorous product-specification interview that resolves every relevant requirement before writing spec.md. Use when the user explicitly invokes /skill:specs to define requirements, user stories, scope, behavior, or acceptance criteria before implementation.
disable-model-invocation: true
---

# Specs

Turn an idea into an implementation-light product spec in `spec.md`.

## Interview contract

Interview the user relentlessly until both sides share the same understanding.

- Ask exactly one question at a time and wait for the answer.
- For every question, give a recommended answer or concrete draft, with brief reasoning.
- Resolve prerequisite decisions before dependent ones. Follow each answer into its relevant branches.
- Find facts in the filesystem, docs, tickets, analytics, product copy, code, tests, or tools instead of asking the user.
- Put product decisions to the user; never silently choose one because it seems obvious.
- Challenge ambiguity, conflicting requirements, hidden assumptions, and untestable language.
- Do not treat silence, partial answers, or moving on as agreement.
- Do not write `spec.md` or begin implementation until the user explicitly confirms shared understanding.

## Workflow

1. **Research context**
   - Check for an existing `spec.md`, `CONTEXT.md`, `README.md`, ADRs, roadmap docs, issues, and relevant product evidence.
   - Reuse established terminology and surface conflicts immediately.

2. **Build the question tree**
   - Inventory known facts, assumptions, decisions, dependencies, and unanswered questions.
   - Cover every relevant branch below; explicitly mark irrelevant branches and why.

3. **Interview one branch at a time**
   - State the question, relevant known facts, and the recommended answer.
   - Explain meaningful alternatives or consequences when they exist.
   - Ask the user to accept, modify, or reject the recommendation, then wait.
   - Keep a running record of agreed decisions and newly opened branches.

4. **Confirm completeness**
   - Recap the proposed spec, assumptions, exclusions, and remaining questions.
   - Ask whether anything is missing and whether shared understanding has been reached.
   - If not confirmed, continue interviewing one question at a time.

5. **Write only after confirmation**
   - Write or update `spec.md` in the current working directory.
   - Preserve genuinely deferred items under `Open questions`; do not use that section to avoid resolvable decisions.

## Question tree

Cover what is relevant:

- problem, evidence, urgency, desired outcome, and success measures
- primary and secondary users, permissions, accessibility, and differing needs
- current experience, entry points, happy path, alternate paths, and completion state
- inputs, outputs, validation, defaults, empty/loading/error/offline states, retries, and recovery
- edge cases, limits, abuse/misuse, privacy, security, compliance, and data lifecycle
- scope, non-goals, compatibility, constraints, dependencies, terminology, and assumptions
- user stories, observable acceptance criteria, analytics/feedback needs, rollout expectations, and risks

Stay at the product-behavior level. When implementation details arise, capture only the user-facing requirement or constraint behind them.

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
## Users and needs
- **[User]:** [Need, current pain, desired outcome]
## User stories
- As a [user], I want [capability], so that [outcome].
## Expected experience
### Happy path
1. [Observable step]
### Alternate paths, edge cases, and errors
- **[Case]:** [Expected behavior]
## Acceptance criteria
- Given [context], when [action], then [observable result].
## Constraints and assumptions
- **Constraint:** [Known limitation]
- **Assumption:** [Belief and validation status]
## Success measures, risks, and open questions
- **Measure:** [How success is observed]
- **Risk:** [Risk and mitigation]
- **Question:** [Intentionally deferred question]
```

Write for a smart non-technical reader. Use concrete, observable language and do not drift into implementation planning.
