function dotsync --description 'Stage tracked dotfiles, commit sync, and push'
    dotfiles add -u

    if dotfiles diff --cached --quiet
        echo 'No tracked dotfile changes to commit.'
        return 0
    end

    dotfiles commit -m sync
    and dotfiles push -u origin (dotfiles branch --show-current)
end
