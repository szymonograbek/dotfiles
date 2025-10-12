export ZSH="$HOME/.oh-my-zsh"

ZSH_THEME="robbyrussell"
plugins=(git asdf zsh-autosuggestions vscode z)

source $ZSH/oh-my-zsh.sh

# Aliases
alias cdg='cd $(git rev-parse --show-toplevel)'
alias dotfiles='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
alias tmuxa='tmux attach -t'
alias tmuxn='tmux new-session -s'
alias dotfiles_sync='dotfiles add .zshrc .tmux.conf .config/nvim .config/yabai .config/skhd; dotfiles commit -m "dotfiles sync"; dotfiles push origin main'
unalias gcf
alias gcf='git checkout $(git branch -a | fzf | xargs)'

# Bindings
bindkey "\e\e[D" backward-word
bindkey "\e\e[C" forward-word

# Android Studio
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools

# pnpm
export PNPM_HOME="/Users/szymonograbek/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end

# Direnv
eval "$(direnv hook zsh)"

# bun completions
[ -s "/Users/szymonograbek/.bun/_bun" ] && source "/Users/szymonograbek/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# SPACESHIP_PROMPT_ASYNC=FALSE
export PATH=$PATH:$HOME/.maestro/bin

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/szymonograbek/Downloads/google-cloud-sdk/path.zsh.inc' ]; then . '/Users/szymonograbek/Downloads/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/Users/szymonograbek/Downloads/google-cloud-sdk/completion.zsh.inc' ]; then . '/Users/szymonograbek/Downloads/google-cloud-sdk/completion.zsh.inc'; fi

alias dotfiles='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
alias ws_start='~/start-workstation.exp'


# BEGIN opam configuration
# This is useful if you're using opam as it adds:
#   - the correct directories to the PATH
#   - auto-completion for the opam binary
# This section can be safely removed at any time if needed.
[[ ! -r '/Users/szymonograbek/.opam/opam-init/init.zsh' ]] || source '/Users/szymonograbek/.opam/opam-init/init.zsh' > /dev/null 2> /dev/null
# END opam configuration

. "$HOME/.local/bin/env"
