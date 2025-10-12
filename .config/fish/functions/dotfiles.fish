function dotfiles --description 'Manage dotfiles git repository'
    /usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME $argv
end
