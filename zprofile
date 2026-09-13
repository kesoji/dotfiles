# cached_eval / clear_cached_eval は zshenv で定義
# (zshrc からも使うため。zprofile はログインシェルでしか読まれない)
#
# ただし zshenv が非対話シェル（ssh host 'cmd'・scp・rsync）でもここを読み込む。
# 非対話で何か出力すると scp/rsync のプロトコルが壊れる（"Received message too long"）ので、
# 案内の表示と自動インストールは対話シェルのときだけにする。PATH 等の設定は常に行う。

# devbox
if ! command -v devbox &>/dev/null; then
    [[ -o interactive ]] && echo "devbox isn't installed: TODO"
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
    if [[ -o interactive ]]; then
        echo "Homebrew isn't installed."
        echo '  Install: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    fi
fi

if command -v brew &>/dev/null; then
    if [[ "$OSTYPE" == darwin* ]]; then
        # macOS: install git-lfs and replace BSD commands with GNU
        git lfs 2>/dev/null 1>&2
        if [[ $? -ne 0 && -o interactive ]]; then
            echo_notice "installing git lfs";
            comexec "$PACKAGE_MANAGER git-lfs"
            comexec "git lfs install"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/coreutils" ]]; then
            [[ -o interactive ]] && echo "replacing core commands from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnuman:$MANPATH"
        elif [[ -o interactive ]]; then
            comexec "$PACKAGE_MANAGER coreutils"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/grep" ]]; then
            [[ -o interactive ]] && echo "replacing grep from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnuman:$MANPATH"
        elif [[ -o interactive ]]; then
            comexec "$PACKAGE_MANAGER grep"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/gsed" ]]; then
            [[ -o interactive ]] && echo "replacing sed from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/gsed/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/gsed/libexec/gnuman:$MANPATH"
        elif [[ -o interactive ]]; then
            comexec "$PACKAGE_MANAGER gsed"
        fi
    fi
    if [[ -e "$HOMEBREW_PREFIX/opt/mysql-client" ]]; then
        export PATH="$HOMEBREW_PREFIX/opt/mysql-client/bin:$PATH"
    fi
fi

export PATH="$HOME/.local/bin:$PATH"

# dotfiles 同期のローカルコマンド（devproxy-bootstrap / devproxy-register / generate-dev-domain 等）
export PATH="$HOME/dotfiles/bin:$PATH"

# Added by Obsidian
export PATH="$PATH:/Applications/Obsidian.app/Contents/MacOS"
