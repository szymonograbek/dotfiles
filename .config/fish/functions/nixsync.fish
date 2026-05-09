function nixsync --description 'Stage nix config, commit sync, and push'
    git -C $HOME/nix add -A

    if git -C $HOME/nix diff --cached --quiet
        echo 'No nix changes to commit.'
        return 0
    end

    git -C $HOME/nix commit -m sync
    and git -C $HOME/nix push -u origin (git -C $HOME/nix branch --show-current)
end
