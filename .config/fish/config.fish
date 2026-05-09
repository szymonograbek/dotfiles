if test (uname) = Darwin
    /opt/homebrew/bin/brew shellenv | source
end

# Add ~/.local/bin to PATH
fish_add_path ~/.local/bin

# Add npm global bin to PATH
fish_add_path ~/.npm-global/bin

# Disable greeting
set fish_greeting 

# Set Editor to neovim
set -gx EDITOR 'nvim'

# Set neovim as the program to open manpages
set -gx MANPAGER 'nvim +Man!'

direnv hook fish | source

# BEGIN opam configuration
# This is useful if you're using opam as it adds:
#   - the correct directories to the PATH
#   - auto-completion for the opam binary
# This section can be safely removed at any time if needed.
test -r '/Users/szymonograbek/.opam/opam-init/init.fish' && source '/Users/szymonograbek/.opam/opam-init/init.fish' > /dev/null 2> /dev/null; or true
# END opam configuration

# Added by OrbStack: command-line tools and integration
# This won't be added again if you remove it.
source ~/.orbstack/shell/init2.fish 2>/dev/null || :
