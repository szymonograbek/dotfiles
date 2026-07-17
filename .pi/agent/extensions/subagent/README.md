# Subagent extension

Runs isolated Pi sessions in terminal surfaces and returns their final responses to the parent agent.

## Structure

- `index.ts` — Pi registration and dependency composition.
- `requests.ts` — tool schema and request normalization.
- `domain.ts` — shared domain types and status helpers.
- `store.ts` — session state, persistence restoration, and cancellation handles.
- `agent-runtime.ts` — Pi session/model/launcher/result protocol and owned artifact paths.
- `child-runtime.ts` — child process lifecycle and operator-interaction tracking.
- `orchestrator.ts` — launch, wait, collect, and cleanup workflow.
- `validation.ts` — shared TypeBox-backed runtime validation.
- `ui.ts` — activity projection, status widget, and manager modal.
- `rendering.ts` — tool call/result rendering.
- `terminal/terminal-host.ts` — terminal integration port.
- `terminal/herdr-terminal.ts` — Herdr adapter.

## Terminal integrations

Code outside `terminal/herdr-terminal.ts` only uses `TerminalHost`, structured process commands, and opaque surface IDs. A future tmux adapter can implement the same create/start/focus/close/isOpen contract without changing orchestration, persistence, or UI code. The host owns created surfaces and provides `closeAll()` for deterministic session shutdown.

The Herdr adapter is bound at composition time to `HERDR_WORKSPACE_ID`, captured from the Pi process environment. New subagent tabs therefore stay in the workspace where Pi started instead of following whichever workspace is currently focused.

## Lifecycle protocol

The child writes its outcome to a private staging file. The launcher publishes that outcome atomically only after Pi exits, so the parent cannot tear down a child before graceful shutdown finishes. If Pi exits without an outcome, the launcher publishes a failure instead.

Interrupting or steering a running child keeps the parent tool call waiting. The child publishes only after it produces a non-aborted response and fully settles, so the parent receives the final response including the operator-guided work. An aborted child with no follow-up remains open and waiting.

Temporary artifact paths are generated for fresh runs and are never restored from session data. Model-visible aggregate output uses Pi's standard 50 KB/2,000-line truncation while full responses remain in persisted child sessions and tool details.

## Dependency choices

TypeBox already defines Pi tool schemas, so `typebox/value` is also used for runtime validation at JSON/session boundaries. This avoids duplicating schemas in Zod or Valibot.

Other packages considered:

- `zod` / `valibot` — strong standalone validation options, but redundant alongside the required TypeBox schemas.
- `execa` — useful for direct subprocess management; unnecessary while command execution and cancellation go through `pi.exec` and the terminal adapter.
- `p-limit` / `p-queue` — useful if concurrency must become bounded or prioritized. Current behavior intentionally launches all requested agents in parallel.
- `p-retry` — useful only after retry semantics and idempotency are explicitly defined.
- `nanoid` — unnecessary because Node's `crypto.randomUUID()` already provides opaque IDs.
