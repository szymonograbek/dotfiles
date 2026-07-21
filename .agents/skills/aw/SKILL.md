---
name: aw
description: Manages isolated Jujutsu, Herdr, Pi, and React Native agent workspaces through the local `aw` Fish function. Use when creating, listing, opening, or removing a dedicated agent workspace, or when the user mentions `aw create`, `aw open`, `aw list`, or `aw remove`.
---

# Agent Workspaces (`aw`)

`aw` is a local Fish function. Run it through Fish, for example:

```sh
fish -lc 'cd /path/to/jj-repo && aw create feature-name'
```

It creates isolated Jujutsu workspaces under `~/dev/agent-workspaces/<repository>/<name>` and stores metadata in `~/.local/state/aw/<repository>/<name>.json`.

## Commands

```sh
aw create <name> [prompt] [--from <revision>]
aw list
aw open <name>
aw remove [name]
```

### Create

Run from inside a Jujutsu repository:

```sh
aw create fix-login
aw create feature/paywall 'Fix the checkout error and run relevant tests.' --from '@-'
aw create sentry-43 '/skill:investigate issue SENTRY-APP-43'
```

- The default base revision is `trunk()`.
- An optional, single quoted `prompt` is passed to the new Pi session when its Herdr workspace is first created. Place it after the name; `--from` may appear before or after it.
- Names may contain slash-separated segments; each segment must start with an alphanumeric character and otherwise use only letters, numbers, `.`, `_`, or `-`.
- Copies `.env.*` files from the source workspace, detects Bun/pnpm/Yarn/npm from `package.json` or lockfiles, and runs `<manager> install`.
- Creates and focuses a Herdr workspace, then starts Pi in it.
- On failure after workspace creation, it preserves the workspace for recovery.

### List and open

```sh
aw list
aw open fix-login
```

`list` reports registered workspaces and whether their Herdr runtime is active. `open` focuses an active Herdr workspace; if it is gone, it recreates it and starts Pi without an initial prompt.

### Remove

```sh
aw remove fix-login
# From within a managed workspace:
aw remove
```

`remove` is destructive and always prompts for confirmation. It shows Jujutsu status, closes the Herdr workspace, shuts down an assigned React Native `rn-iso` runtime when applicable, forgets the Jujutsu workspace, deletes its directory, and removes its state file.

Do not automate or bypass the confirmation without explicit user approval.

## Agent guidance

- Before VCS work, check for `.jj/`; use `jj`, not Git, in these workspaces.
- Use `aw create` only when the user asks for a separate/isolated workspace or worktree-like environment.
- Run `aw create` from the intended repository, not from an existing agent workspace unless that is intentional.
- Workspace names are globally resolved across registered repositories; `aw open` and named `aw remove` fail if a name is ambiguous.
- `aw remove` without a name works only from a workspace registered by `aw`.
