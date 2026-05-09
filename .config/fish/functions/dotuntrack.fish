function dotuntrack --description 'Stop tracking files in dotfiles without deleting them'
    if test (count $argv) -eq 0
        echo 'Usage: dotuntrack <file-or-dir> [...]' >&2
        return 2
    end

    dotfiles rm --cached -r -- $argv
end
