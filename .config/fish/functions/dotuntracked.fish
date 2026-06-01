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

    /usr/bin/git -C $HOME --git-dir=$HOME/.dotfiles/ --work-tree=$HOME \
        ls-files --others --exclude-standard -- "$abs_dir" \
        | sed "s|^|$HOME/|" \
        | sort
end
