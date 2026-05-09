function otree -d "cd into git worktree by branch name" -a branch
  if test (count $argv) -ne 1
    echo "Usage: otree <branch>"
    return 1
  end

  set -l repo_name (basename (git rev-parse --show-toplevel))
  or return 1

  set -l dir_name (string replace -a '/' '-' $branch)
  set -l tree_path ~/dev/$repo_name-trees/$dir_name

  if not test -d $tree_path
    echo "Worktree not found: $tree_path"
    return 1
  end

  cd $tree_path
end
