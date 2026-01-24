function track-claude-md -d "Undo skip worktree for CLAUDE.md"
    if not git rev-parse --is-inside-work-tree &>/dev/null
        echo "Not in git repo"
        return 1
    end

    if not test -f CLAUDE.md
        echo "CLAUDE.md not found"
        return 1
    end

    git update-index --no-skip-worktree CLAUDE.md
    echo "CLAUDE.md tracking restored"
end
