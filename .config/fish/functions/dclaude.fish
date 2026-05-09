function dclaude
    if contains -- --full $argv
        set argv (string match -v -- --full $argv)
        claude --dangerously-skip-permissions $argv
    else if test -f CLAUDE.md; and test (wc -l < CLAUDE.md | string trim) -gt 120
        claude --dangerously-skip-permissions --setting-sources user $argv
    else
        claude --dangerously-skip-permissions $argv
    end
end
