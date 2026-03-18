function cached_eval {
    CACHE_DIR=~/.local/cache/zshrc-eval
    [[ ! -d "$CACHE_DIR" ]] && mkdir -p "$CACHE_DIR"

    CACHE_FILE="$CACHE_DIR/${1// /_}"
    [[ ! -e "$CACHE_FILE" ]] && eval "$1" > "$CACHE_FILE"
    source "$CACHE_FILE"
}
function clear_cached_eval {
    rm -rf ~/.local/cache/zshrc-eval
}

# devbox
command -v devbox 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo "devbox isn't installed: TODO"
else
    # Optimized: cached for faster startup
    cached_eval "devbox global shellenv"
    alias db='devbox'
    alias dbi='devbox init'
    alias dba='devbox add'
    alias dbr='devbox run'
    if [[ -d ~/.oh-my-zsh && ! -e ~/.oh-my-zsh/completions/_devbox ]]; then
        mkdir -p ~/.oh-my-zsh/completions
        devbox completion zsh > ~/.oh-my-zsh/completions/_devbox
    fi
fi

# homebrew
eval $(/opt/homebrew/bin/brew shellenv)
command -v brew 2>/dev/null 1>&2
if [[ $? -ne 0 ]]; then
    echo "Homebrew isn't installed."
else
    git lfs 2>/dev/null 1>&2
    if [[ $? -ne 0 ]]; then
        echo_notice "installing git lfs";
        comexec "$MAC_INSTALLER git-lfs"
        comexec "git lfs install"
    fi
    if [[ -e "$HOMEBREW_PREFIX/opt/coreutils" ]]; then
        echo "replacing core commands from BSD to GNU"
        export PATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnubin:$PATH"
        export MANPATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnuman:$MANPATH"
    else
        comexec "$MAC_INSTALLER coreutils"
    fi
    if [[ -e "$HOMEBREW_PREFIX/opt/grep" ]]; then
        echo "replacing grep from BSD to GNU"
        export PATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnubin:$PATH"
        export MANPATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnuman:$MANPATH"
    else
        comexec "$MAC_INSTALLER grep"
    fi
    if [[ -e "$HOMEBREW_PREFIX/opt/gsed" ]]; then
        echo "replacing sed from BSD to GNU"
        export PATH="$HOMEBREW_PREFIX/opt/gsed/libexec/gnubin:$PATH"
        export MANPATH="$HOMEBREW_PREFIX/opt/gsed/libexec/gnuman:$MANPATH"
    else
        comexec "$MAC_INSTALLER gsed"
    fi
    if [[ -e "$HOMEBREW_PREFIX/opt/mysql-client" ]]; then
      export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
    fi
fi

export PATH="~/.local/bin:$PATH"

# Added by Obsidian
export PATH="$PATH:/Applications/Obsidian.app/Contents/MacOS"
