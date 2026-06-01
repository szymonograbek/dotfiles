function dotuntracked --description 'List files in a directory not tracked by dotfiles'
    set -l dir $argv[1]

    if test -z "$dir"
        echo 'Usage: dotuntracked <dir>' >&2
        return 2
    end

    set -l abs_dir (path resolve $dir)

    if not test -d "$abs_dir"
        echo "Not a directory: $dir" >&2
        return 2
    end

    begin
        cd $HOME
        dotfiles ls-files --others --exclude-standard -- "$abs_dir"
    end \
        | sed "s|^|$HOME/|" \
        | sort
end
