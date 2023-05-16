# Installation

```
alias dotfiles='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
```

```
echo ".dotfiles" >> .gitignore
```

```
git clone --bare <git-repo-url> $HOME/.dotfiles
```

```
dotfiles checkout
```

```
config config --local status.showUntrackedFiles no
```
