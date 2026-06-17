---
name: jj
description: "Use jj (Jujutsu) for local version control instead of git. Activate when: the repo has a .jj/ directory, the user or project config mentions jj, the user says 'use jj', or any version control operation is needed in a jj-managed repo. Also use this skill when the user asks to commit, branch, stash, rebase, or perform any git-like operation in a repo that uses jj. If unsure whether the repo uses jj, check for a .jj/ directory."
---

# jj (Jujutsu) — Version Control for Agent Workflows

## Core Mental Model

- **Working copy is always a commit** (`@`). Every file edit auto-amends it. No staging area, no `git add`.
- **Change ID** (e.g. `kntqzsqt`) is stable across rewrites. Use it as a reference — short prefixes work.
- **No active branch.** Work directly with commits. Bookmarks (= git branches) are only needed for pushing.
- **Bookmarks follow rebases.** Unlike git branches, they move with commits automatically.

## Detecting a jj Repo

```bash
test -d .jj && echo "jj repo"
```

When both `.jj/` and `.git/` exist (colocated), always use `jj` commands.

## Essential Commands

```bash
# State
jj st                          # status
jj log                         # commit graph
jj diff                        # diff of working copy
jj diff -r <rev>               # diff of a specific commit
jj show <rev>...               # show one or more commits

# Making changes
jj describe -m "msg"           # set message on current change
jj new                         # seal current change, start a new one
jj new -m "msg"                # same, with message
jj new -A <rev>                # insert new change after a revision
jj edit <rev>                  # jump to older commit and amend it (descendants auto-rebase)
jj squash                      # squash working copy into parent
jj squash --from <rev> --into <rev>  # move changes between specific commits
jj split -r <rev> <file>...   # split by moving specific files into the first commit
jj abandon <rev>               # discard a commit (descendants rebase to its parent)

# Rebasing
jj rebase -o <dest>            # rebase working copy onto dest
jj rebase -r <rev> -o <dest>   # rebase a specific commit
jj rebase -s <rev> -o <dest>   # rebase rev and all its descendants

# Conflicts — never block operations; stored as objects, resolved later
jj resolve --list              # list conflicted files
jj resolve --tool=:ours       # resolve all conflicts by taking our side
jj resolve --tool=:theirs     # resolve all conflicts by taking their side

# Bookmarks
jj bookmark create <name>      # create at working copy
jj bookmark set <name>         # move to working copy
jj bookmark advance            # move bookmark forward to @
jj bookmark track main --remote origin  # track a remote bookmark

# Git interop
jj git fetch                   # fetch; remote rewrites with preserved change IDs auto-rebase descendants
jj git push
jj git push --bookmark <name>  # push a specific bookmark
jj git init --colocate         # init jj in existing git repo

# Safety net
jj undo                        # undo last operation (always safe)
jj op log                      # full operation history
jj op restore <op-id>          # restore repo to any past state
```

## Key Patterns

**Start next task:** `jj new` — previous change is preserved, no stash needed.

**Edit older commit:** `jj edit <rev>`, make changes, done. All descendants rebase automatically.

**Stack of PRs:** Create a chain of changes, `jj bookmark create pr1/pr2/pr3` at each, push separately. When pr1 needs a fix, `jj edit` into it — descendants auto-rebase, repush each bookmark.

**Undo anything:** `jj undo`. Nothing is ever lost — use `jj op log` + `jj op restore` to go further back.

**No stash:** Just `jj new` off a different base, do the work, then `jj edit` back.

## Common Mistakes

- Do not use `git add`, `git commit`, `git stash`, or `git checkout` in a jj repo.
- Prefer `--onto`/`-o`; `--destination`/`-d` is deprecated.
- Do not create bookmarks for local-only work — they're only needed for remotes.
- Do not worry about losing work — `jj undo` / `jj op restore` recovers everything.
