function dtree -d "Delete git worktree by branch name, or current worktree if no args"
  set -l toplevel (git rev-parse --show-toplevel)
  or return 1

  if test (count $argv) -eq 0
    set -l common_dir (git rev-parse --git-common-dir)
    set -l git_dir (git rev-parse --git-dir)

    if test "$common_dir" = "$git_dir"
      echo "Not in a worktree"
      return 1
    end

    set -l branch (git rev-parse --abbrev-ref HEAD)
    set -l main_repo (realpath "$common_dir/..")

    cd $main_repo
    git worktree remove $toplevel
    and git branch -d $branch
  else if test (count $argv) -eq 1
    set -l branch $argv[1]
    set -l repo_name (basename $toplevel)
    set -l dir_name (string replace -a '/' '-' $branch)
    set -l tree_path ~/dev/$repo_name-trees/$dir_name

    git worktree remove $tree_path
    and git branch -d $branch
  else
    echo "Usage: dtree [<branch>]"
    return 1
  end
end
