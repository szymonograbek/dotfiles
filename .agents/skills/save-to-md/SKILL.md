---
name: save-to-md
description: Save important information from the current agent conversation into a human-readable Markdown document. Use when the user invokes /save-to-md, asks to save an investigation/decision/summary to an .md file, or wants conversation context captured as documentation or an ADR-like record.
---

# Save to Markdown

## Quick start

When asked to save conversation context to Markdown:

1. Identify the requested subject from the user prompt.
2. If no subject is provided, summarize the whole current conversation.
3. Write a structured Markdown document to the requested file path, or `doc.md` by default.
4. Include enough detail for a human to understand the history, evidence, decisions, and references later.

Default behavior favors completeness over brevity. Be concise only when explicitly asked.

## Workflow

### 1. Determine scope

- If the prompt names a topic, save only the relevant parts of the conversation.
- If the prompt is vague, infer the main investigation/task from the full conversation.
- If multiple materially different topics exist and scope is unclear, ask one short clarification.
- If a filename/path is provided, use it. Otherwise use `doc.md` in the current working directory.

### 2. Reconstruct the narrative

Before writing, think through:

- What triggered the work?
- What was investigated or discussed?
- What files, commands, tools, URLs, tickets, logs, or outputs were referenced?
- What conclusions were reached?
- What decisions or tradeoffs were made?
- What remains unresolved?

Write it as a readable document, not a chat transcript.

### 3. Use this document shape

Adapt headings as needed, but default to:

```md
# <Clear title>

## Summary

<Short overview of what happened and why it matters.>

## Context

<Background and original request/problem.>

## Timeline / Investigation

<Chronological narrative of important steps, observations, and evidence.>

## Findings

- <Finding with supporting evidence/reference.>
- <Finding with supporting evidence/reference.>

## Decisions

- <Decision or conclusion, with rationale.>

## References

- `<file/path>` — <why it mattered>
- `<command>` — <what it showed>
- <URL/ticket/log reference> — <why it mattered>

## Open Questions / Follow-ups

- <Unresolved item or next step.>
```

For ADR-like content, include `Status`, `Decision`, `Consequences`, and `Alternatives considered`.

### 4. Writing rules

- Make it human-readable, like project documentation or an ADR.
- Preserve concrete evidence: file paths, function names, commands, errors, URLs, ticket IDs, and exact outputs when important.
- Do not include irrelevant tool chatter or internal reasoning.
- Do not invent references or conclusions not supported by the conversation.
- Prefer detailed, structured prose by default.
- If the user asks for concise output, reduce detail but keep key evidence and decisions.

### 5. Save and report

- Create parent directories if needed.
- Use `write` for a new file or complete overwrite.
- Use `edit` only when updating an existing document surgically.
- After saving, respond with the file path and a one-line description of what was captured.
