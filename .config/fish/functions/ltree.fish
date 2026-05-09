function ltree -d "List worktrees for current repo"
  set -l repo_name (basename (git rev-parse --show-toplevel))
  or return 1

  git worktree list
end
