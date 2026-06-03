---
name: grounding
description: Ground agent hypotheses in verifiable evidence from source code, docs, issues, and concrete citations before acting. Use when investigating bugs, library behavior, architecture questions, ambiguous errors, or any task where guessing, assumptions, or stale knowledge could lead to wrong changes.
---

# Grounding

## Purpose

Use this skill to replace guesses with evidence. Every meaningful hypothesis must be tied to concrete data: source code, docs, reproducible output, issue discussions, or cited references.

Avoid language like "possibly", "most likely", "classic problem", or "usually" unless immediately paired with evidence and a verification step.

## Quick start

1. State the question being grounded.
2. Collect primary evidence first:
   - repository source code
   - installed dependency source in `node_modules` or equivalent
   - official docs tied to the exact version in use
   - local command output, tests, logs, or reproduction steps
3. For third-party libraries, inspect implementation:
   - read installed package source
   - clone the library to a temporary directory
   - use `gh` to inspect GitHub source, releases, issues, and PRs
4. For known problems, search external reports:
   - GitHub issues and discussions
   - Stack Overflow answers
   - changelogs and release notes
5. Prefer source code over docs. Prefer official/project sources over random replies.
6. Verify community answers before using them. Reject quick fixes that work by degrading correctness, type safety, security, or maintainability.
7. Report only grounded conclusions with citations or concrete file paths/commands.

## Evidence hierarchy

Use the strongest available evidence:

1. Current project code and reproducible local output.
2. Installed dependency source matching the project lockfile/version.
3. Upstream source at the matching tag/commit.
4. Official docs for the matching version.
5. Maintainer comments, merged PRs, changelogs, and release notes.
6. Community answers, only after independent verification.

## Workflow

### Investigating a hypothesis

- Write the hypothesis as a testable claim.
- Identify what evidence would prove or disprove it.
- Read or run the minimum needed checks.
- Record exact paths, line references, URLs, issue numbers, command output, or test results.
- If evidence contradicts the hypothesis, discard or revise it.

### Working with third-party libraries

- Determine the exact package name and version from lockfiles or package metadata.
- Inspect local installed source first when available.
- If local source is incomplete, clone/fetch upstream and check the matching tag.
- Search issues/PRs for the exact error, API, or behavior.
- Treat docs as helpful but secondary to implementation.

### Reporting

Structure findings as:

- **Claim:** concise conclusion.
- **Evidence:** file paths, commands, URLs, issue/PR links, or quoted docs/source.
- **Implication:** what this means for the task.
- **Confidence:** only as strong as the evidence allows.

If evidence is missing, say what is missing and what check would resolve it. Do not fill gaps with guesses.

## Red flags

Stop and gather more evidence when you notice:

- relying on memory of library behavior
- using words like "probably" without proof
- accepting a forum answer without reading source or docs
- assuming current behavior from old versions
- applying a workaround without understanding the tradeoff
- changing code before reproducing or locating the cause
