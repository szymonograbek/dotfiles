function ctree -d "Create git worktree in ~/dev/<repo>-trees/<branch>"
  if test (count $argv) -lt 1 -o (count $argv) -gt 2
    echo "Usage: ctree [<base_branch>] <new_branch>"
    return 1
  end

  set -l repo_name (basename (git rev-parse --show-toplevel))
  or return 1

  set -l trees_dir ~/dev/$repo_name-trees

  if test (count $argv) -eq 2
    set -l base $argv[1]
    set -l branch $argv[2]
    set -l dir_name (string replace -a '/' '-' $branch)
    set -l tree_path $trees_dir/$dir_name

    mkdir -p $trees_dir
    git worktree add -b $branch $tree_path $base
    and cd $tree_path
  else
    set -l branch $argv[1]
    set -l dir_name (string replace -a '/' '-' $branch)
    set -l tree_path $trees_dir/$dir_name

    mkdir -p $trees_dir
    git worktree add $tree_path $branch
    and cd $tree_path
  end
end
