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
if ! command -v devbox &>/dev/null; then
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
if [[ -x /opt/homebrew/bin/brew ]]; then
    eval $(/opt/homebrew/bin/brew shellenv)
elif [[ -x /home/linuxbrew/.linuxbrew/bin/brew ]]; then
    eval $(/home/linuxbrew/.linuxbrew/bin/brew shellenv)
elif [[ -x /usr/local/bin/brew ]]; then
    eval $(/usr/local/bin/brew shellenv)
else
    echo "Homebrew isn't installed."
    echo '  Install: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
fi

if command -v brew &>/dev/null; then
    if [[ "$OSTYPE" == darwin* ]]; then
        # macOS: install git-lfs and replace BSD commands with GNU
        git lfs 2>/dev/null 1>&2
        if [[ $? -ne 0 ]]; then
            echo_notice "installing git lfs";
            comexec "$PACKAGE_MANAGER git-lfs"
            comexec "git lfs install"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/coreutils" ]]; then
            echo "replacing core commands from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnuman:$MANPATH"
        else
            comexec "$PACKAGE_MANAGER coreutils"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/grep" ]]; then
            echo "replacing grep from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnuman:$MANPATH"
        else
            comexec "$PACKAGE_MANAGER grep"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/gsed" ]]; then
            echo "replacing sed from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/gsed/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/gsed/libexec/gnuman:$MANPATH"
        else
            comexec "$PACKAGE_MANAGER gsed"
        fi
    fi
    if [[ -e "$HOMEBREW_PREFIX/opt/mysql-client" ]]; then
        export PATH="$HOMEBREW_PREFIX/opt/mysql-client/bin:$PATH"
    fi
fi

export PATH="$HOME/.local/bin:$PATH"

# Added by Obsidian
export PATH="$PATH:/Applications/Obsidian.app/Contents/MacOS"
