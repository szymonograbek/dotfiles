---
name: specs
description: Guides a lightweight product/specification session that turns an idea into user stories, goals, constraints, and acceptance criteria without diving into implementation. Use when the user explicitly invokes /skill:specs to write a spec, define requirements, shape user stories, or clarify what to achieve before coding.
disable-model-invocation: true
---

# Specs

## What to do

Create a clear, implementation-light product spec in `spec.md`.

Interview the user one question at a time. For each question, provide a recommended answer or concrete draft they can accept, edit, or reject.

Focus on users, problems, outcomes, user stories, scenarios, scope, non-goals, acceptance criteria, open questions, and risks.

Avoid implementation planning. If implementation details appear, capture only the user-facing requirement or constraint behind them. If existing docs, tickets, product copy, analytics, or code can answer a question, inspect those sources instead of asking.

## Workflow

1. **Find context**
   - Check for existing `spec.md` and product/domain docs such as `CONTEXT.md`, `README.md`, ADRs, roadmap docs, or issues.
   - Reuse existing terminology. Call out conflicts or vague terms immediately.

2. **Frame the spec**
   - Clarify the change, problem, primary users, and desired outcome.
   - Draft concise wording for each section as the conversation progresses.

3. **Shape requirements**
   - Write user stories: `As a [user], I want [capability], so that [outcome].`
   - Cover happy paths, edge cases, error states, and non-goals.
   - Keep acceptance criteria observable and testable.

4. **Write `spec.md`**
   - Save the finished spec as `spec.md` in the current working directory.
   - If it already exists, update it in place.
   - Keep unresolved items in `Open questions`.

## `spec.md` format

```md
# [Spec title]

## At a glance

**Problem:** [One sentence.]
**Goal:** [One sentence.]
**Primary users:** [Comma-separated list.]
**Status:** Draft

## Why this matters

[Short explanation of the user or business problem.]

## What we are trying to achieve

- [Outcome]

## What is out of scope

- [Non-goal]

## Users and needs

### [User type]

- **Need:** [What they need]
- **Current pain:** [What is hard today]
- **Desired outcome:** [What gets better]

## User stories

- As a [user], I want [capability], so that [outcome].

## Expected experience

### Happy path

1. [Observable user-facing step]

### Edge cases and errors

- **[Case]:** [Expected behavior]

## Acceptance criteria

- Given [context], when [action], then [observable result].

## Constraints, assumptions, and open questions

- **Constraint:** [Known limitation or requirement]
- **Assumption:** [Believed true but not proven]
- **Question:** [Unresolved question]
```

## Readability rules

Write for a smart non-technical reader. Put the most important information first. Use clear headings, short paragraphs, concrete bullets, and examples. Do not switch into implementation planning unless explicitly asked.
