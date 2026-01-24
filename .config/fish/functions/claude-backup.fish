function claude-backup -d "Backup CLAUDE.md to ~/.claude-backups"
    if not test -f CLAUDE.md
        echo "CLAUDE.md not found"
        return 1
    end

    set backup_dir ~/.claude-backups
    mkdir -p $backup_dir

    set timestamp (date +%Y%m%d_%H%M%S)
    set repo_name (basename (pwd))
    set backup_file "$backup_dir/$repo_name-$timestamp.md"

    cp CLAUDE.md $backup_file
    echo "Backed up to $backup_file"
end
