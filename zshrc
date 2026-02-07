# Kiro CLI pre block. Keep at the top of this file.
[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh"
# Q pre block. Keep at the top of this file.
# Disabled for faster startup - zcompile happens automatically by zsh
# Removing this check eliminates ~7% startup time overhead
# Downside: Negligible - automatic compilation still works via other mechanisms
#if [ ~/.zshrc -nt ~/.zshrc.zwc ]; then
#    zcompile ~/.zshrc
#fi

function echo_error {
    echo -e "\e[31m$@\e[m"
}
function echo_notice {
    echo -e "\e[33;5;243m$@\e[m"
}
function echo_info {
    echo -e "\e[38;5;243m$@\e[m"
}
function comexec() {
    echo_info ">>> $1"; eval $1
}
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

MAC=false
if [ "$(uname)" = 'Darwin' ] ; then
    MAC=true
    MAC_INSTALLER="brew install"
fi
if $MAC; then
    command -v brew 2>/dev/null 1>&2
    if [[ $? -ne 0 ]]; then
        echo_info "Homebrew isn't installed."
    else
        git lfs 2>/dev/null 1>&2
        if [[ $? -ne 0 ]]; then
            echo_notice "installing git lfs";
            comexec "$MAC_INSTALLER git-lfs"
            comexec "git lfs install"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/coreutils" ]]; then
            echo_info "replacing core commands from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnuman:$MANPATH"
        else
            comexec "$MAC_INSTALLER coreutils"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/grep" ]]; then
            echo_info "replacing grep from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnuman:$MANPATH"
        else
            comexec "$MAC_INSTALLER grep"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/gsed" ]]; then
            echo_info "replacing sed from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/gsed/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/gsed/libexec/gnuman:$MANPATH"
        else
            comexec "$MAC_INSTALLER gsed"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/mysql-client" ]]; then
          export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
        fi
    fi
fi

WSL=false
if [[ "$(uname -a)" =~ "microsoft" ]]; then
    WSL=true
fi
if $WSL; then
    # remove windows PATH for WSL 2
    export PATH=`echo $PATH | sed -e 's@/mnt/c/.*:@@g'`

    # open google-chrome
    if [[ ! -x ~/my/bin/google-chrome ]]; then
        mkdir -p ~/my/bin
        cat << 'SCRIPT' > ~/my/bin/google-chrome
#!/bin/sh
exec /mnt/c/Program\ Files/Google/Chrome/Application/chrome.exe "$@"
SCRIPT
        chmod +x ~/my/bin/google-chrome
    fi
    export BROWSER=$HOME/my/bin/google-chrome

    # env-specific command alias
    # これがなぜかtmuxを壊す！なんだこれ！
    #echo $(/mnt/c/Windows/System32/wsl.exe wslpath C:/Windows/System32/clip.exe)
    clip_cmd=/mnt/c/Windows/System32/clip.exe
    alias clip=$clip_cmd
    alias pbcopy=$clip_cmd
    alias cl=$clip_cmd
    alias -g C="| $clip_cmd"

    # add repository
    function my-addaptrepos {
        comexec "sudo add-apt-repository ppa:jonathonf/vim"
        comexec "sudo add-apt-repository ppa:longsleep/golang-backports"
    }

    # docker wsl tweak
    export PATH="$PATH:/mnt/c/Program Files/Docker/Docker/resources/bin:/mnt/c/ProgramData/DockerDesktop/version-bin"

    # export DOCKER_HOST='tcp://0.0.0.0:2375'
    function mountdrive() {
        [ -z "$1" ] && echo "usage: mountdrive letter" && return 1
        UPPER=$(echo "$1" | tr '[:lower:]' '[:upper:]' )
        LOWER=$(echo "$UPPER" | tr '[:upper:]' '[:lower:]' )
        sudo mkdir -p "/mnt/$LOWER"
        sudo mount -t drvfs "${UPPER}:" "/mnt/$LOWER"
    }
fi


export PATH=$HOME/.local/bin:$HOME/my/sbin:$HOME/my/bin:$PATH
export PATH=$HOME/.local/share/flutter/bin:$PATH


if [[ -d "$HOME/.oh-my-zsh" ]]; then
    # If you come from bash you might have to change your $PATH.
    # export PATH=$HOME/bin:/usr/local/bin:$PATH

    # Path to your oh-my-zsh installation.
    export ZSH="$HOME/.oh-my-zsh"

    # Set name of the theme to load --- if set to "random", it will
    # load a random theme each time oh-my-zsh is loaded, in which case,
    # to know which specific one was loaded, run: echo $RANDOM_THEME
    # See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
    ZSH_THEME="amuse"

    # Set list of themes to pick from when loading at random
    # Setting this variable when ZSH_THEME=random will cause zsh to load
    # a theme from this variable instead of looking in $ZSH/themes/
    # If set to an empty array, this variable will have no effect.
    # ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

    # Uncomment the following line to use case-sensitive completion.
    # CASE_SENSITIVE="true"

    # Uncomment the following line to use hyphen-insensitive completion.
    # Case-sensitive completion must be off. _ and - will be interchangeable.
    # HYPHEN_INSENSITIVE="true"

    # Uncomment one of the following lines to change the auto-update behavior
    # zstyle ':omz:update' mode disabled  # disable automatic updates
    # zstyle ':omz:update' mode auto      # update automatically without asking
    # zstyle ':omz:update' mode reminder  # just remind me to update when it's time

    # Uncomment the following line to change how often to auto-update (in days).
    # zstyle ':omz:update' frequency 13

    # Uncomment the following line if pasting URLs and other text is messed up.
    # DISABLE_MAGIC_FUNCTIONS="true"

    # Uncomment the following line to disable colors in ls.
    # DISABLE_LS_COLORS="true"

    # Uncomment the following line to disable auto-setting terminal title.
    # DISABLE_AUTO_TITLE="true"

    # Uncomment the following line to enable command auto-correction.
    # ENABLE_CORRECTION="true"

    # Uncomment the following line to display red dots whilst waiting for completion.
    # You can also set it to another string to have that shown instead of the default red dots.
    # e.g. COMPLETION_WAITING_DOTS="%F{yellow}waiting...%f"
    # Caution: this setting can cause issues with multiline prompts in zsh < 5.7.1 (see #5765)
    # COMPLETION_WAITING_DOTS="true"

    # Uncomment the following line if you want to disable marking untracked files
    # under VCS as dirty. This makes repository status check for large repositories
    # much, much faster.
    # DISABLE_UNTRACKED_FILES_DIRTY="true"

    # Uncomment the following line if you want to change the command execution time
    # stamp shown in the history command output.
    # You can set one of the optional three formats:
    # "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
    # or set a custom format using the strftime function format specifications,
    # see 'man strftime' for details.
    # HIST_STAMPS="mm/dd/yyyy"

    # Would you like to use another custom folder than $ZSH/custom?
    # ZSH_CUSTOM=/path/to/new-custom-folder

    # Which plugins would you like to load?
    # Standard plugins can be found in $ZSH/plugins/
    # Custom plugins may be added to $ZSH_CUSTOM/plugins/
    # Example format: plugins=(rails git textmate ruby lighthouse)
    # Add wisely, as too many plugins slow down shell startup.
    plugins=(git docker docker-compose)

    source $ZSH/oh-my-zsh.sh

    # User configuration

    # export MANPATH="/usr/local/man:$MANPATH"

    # You may need to manually set your language environment
    # export LANG=en_US.UTF-8

    # Preferred editor for local and remote sessions
    # if [[ -n $SSH_CONNECTION ]]; then
    #   export EDITOR='vim'
    # else
    #   export EDITOR='mvim'
    # fi

    # Compilation flags
    # export ARCHFLAGS="-arch x86_64"

    # Set personal aliases, overriding those provided by oh-my-zsh libs,
    # plugins, and themes. Aliases can be placed here, though oh-my-zsh
    # users are encouraged to define aliases within the ZSH_CUSTOM folder.
    # For a full list of active aliases, run `alias`.
    #
    # Example aliases
    # alias zshconfig="mate ~/.zshrc"
    # alias ohmyzsh="mate ~/.oh-my-zsh"
else
    echo_info "oh-my-zsh isn't installed: my-ohmyzshinstall"
    function my-ohmyzshinstall() {
        comexec 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"'
    }
fi

# mise
command -v mise 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "mise isn't installed: let's visit https://mise.jdx.dev/getting-started.html#alternate-installation-methods OR my-miseinstall";
    function my-miseinstall() {
        comexec "curl https://mise.run | sh" || return
    }
else
    # https://mise.jdx.dev/dev-tools/shims.html
    #こっちはnot interactive用らしい。
    #eval "$(mise activate zsh --shims)" # should be first 
    eval "$(mise activate zsh)"
    # eval "$(mise hook-env -s zsh)"
    if [[ ! -e ~/.local/share/zsh/completions/_mise ]]; then
        mkdir -p ~/.local/share/zsh/completions
        mise completion zsh > ~/.local/share/zsh/completions/_mise
    fi
fi

# devbox
command -v devbox 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "devbox isn't installed: TODO"
else
    eval "$(devbox global shellenv)"
    alias db='devbox'
    alias dbi='devbox init'
    alias dba='devbox add'
    alias dbr='devbox run'
    if [[ ! -e ~/.oh-my-zsh/completions/_devbox ]]; then
        mkdir -p ~/.oh-my-zsh/completions
        devbox completion zsh > ~/.oh-my-zsh/completions/_devbox
    fi
fi


if [ -e /snap ]; then
    export PATH="/snap/bin:$PATH"
fi

# neovim
function my-neoviminstall() {
    temp_dir=$(mktemp -d)
    cd "$temp_dir" || exit
    arch=$(uname -m)
    case $arch in
        x86_64)
            arch_name="linux-x86_64"
            ;;
        aarch64)
            arch_name="linux-arm64"
            ;;
        *)
            echo "未対応のアーキテクチャです: $arch"
            exit 1
            ;;
    esac
    latest_url=$(curl -s https://api.github.com/repos/neovim/neovim/releases/latest \
        | grep "browser_download_url.*nvim-${arch_name}.tar.gz\"" \
        | cut -d '"' -f 4)

    if [ -z "$latest_url" ]; then
        echo "最新版のURLの取得に失敗しました"
        exit 1
    fi
    # ダウンロードと展開
    echo "Neovimの最新版をダウンロード中..."
    curl -L "$latest_url" -o nvim.tar.gz

    echo "ファイルを展開中..."
    tar xzf nvim.tar.gz

    # neovimバイナリを~/.local/binにコピー
    echo "Neovimをインストール中..."
    cp ./nvim-${arch_name}/bin/nvim ~/.local/bin/

    # パーミッションの設定
    chmod +x ~/.local/bin/nvim

    # 一時ディレクトリの削除
    cd
    rm -rf "$temp_dir"

    echo "インストールが完了しました"
    echo "Neovimのバージョン:"
    ~/.local/bin/nvim --version | head -n 1
}

###### SSH Setting ######
function my-sshkeyadd (){
    if $MAC; then
        ssh-add --apple-use-keychain ~/.ssh/id_ed25519_work
    else
        ssh-add -t 72h ~/.ssh/id_ed25519_work
    fi
}
function my-sshkeyadd_agentoff (){
    eval $(ssh-agent -k)
}

#export SSH_AUTH_SOCK=~/Library/Group\ Containers/2BUA8C4S2C.com.1password/t/agent.sock
# ssh_agent
if [[ ! -v SSH_AGENT_PID ]] ; then
    echo -n "Starting ssh-agent... "
    eval $(ssh-agent -t 24h)
else
    echo "ssh-agent is already started"
fi
ssh-add -l 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    #echo
    #echo "skip adding ssh-key? (y/N)"
    #if read -q ; then
    #else
        echo_notice "Adding my keys"
        my-sshkeyadd
    #fi
fi
#===== SSH Setting ======

command -v tmux 2>/dev/null 1>&2
if [[ $? -ne 0 ]]; then
    echo_info "tmux isn't installed: my-tmuxinstall"
    function my-tmuxinstall() {
        if [ "$(uname)" = 'Darwin' ] ; then
            brew install tmux
        else
            sudo apt -y install tmux
        fi
    }
else
    alias tmux='tmux -2'
    alias tma='tmux -2 a'
    alias tmux-zsh='SHELL=/bin/zsh tmux'
    alias tma-zsh='SHELL=/bin/zsh tmux -2 a'
fi

# Performance optimization: Skip compaudit security checks
# This eliminates ~31% of startup time overhead
# Downside: Won't warn if completion directories have insecure permissions
# Safe for personal Mac, but avoid on multi-user servers
skip_global_compinit=1

fpath=(~/.zsh/completions $fpath)
fpath=(~/.local/share/zsh/completions $fpath)
if [[ -s ~/.stripe/stripe-completion.zsh ]]; then
    fpath=(~/.stripe $fpath)
    autoload -Uz compinit && compinit -i
fi

HISTFILE=~/.zsh_history
HISTSIZE=20000
SAVEHIST=20000
setopt share_history
setopt histignorealldups
setopt histignorespace
# fzf may override these settings
bindkey '^r' history-incremental-pattern-search-backward
bindkey '^s' history-incremental-pattern-search-forward


# essentials
command -v make 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    if $WSL; then
        echo "I think this is first installation. Installing gcc, make..."
        comexec "sudo apt -y update"
        comexec "sudo apt -y install build-essential git unzip"
    fi
fi

# enable completion with caching (regenerate once per day)
# This eliminates ~18% of startup time overhead by using cached completion dump
# Downside: New commands installed won't have completion until cache expires (24h)
# or you manually run: rm ~/.zcompdump*
autoload -Uz compinit
setopt EXTENDEDGLOB
for dump in $HOME/.zcompdump(#qN.m+1); do
  compinit -u
  if [[ -s "$dump" && (! -s "$dump.zwc" || "$dump" -nt "$dump.zwc") ]]; then
    zcompile "$dump"
  fi
done
unsetopt EXTENDEDGLOB
compinit -C -u

setopt auto_cd
setopt auto_pushd
DIRSTACKSIZE=100
# can cd with only this str
cdpath=(.. ~)
## ignore case
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'
## minified style
setopt list_packed
## colore
zstyle ':completion:*' list-colors ''
## enable menu-style
zstyle ':completion:*' menu select
## exclude current dir
zstyle ':completion:*:cd:*' ignore-parents parent pwd
## message
zstyle ':completion:*:descriptions' format '%BCompleting%b %U%d%u'


autoload -Uz bashcompinit && bashcompinit -i

# 20220213 zpreztoより前に置くなぜかおかしくなる
#set -o vi
set -o emacs

# 20220322 これは設定しちゃいけないらしい
#export TERM=xterm-256color
export XDG_CONFIG_HOME=$HOME/.config

# 自前ビルドしたやつ。最近やってないのでコメントアウト
#export MANPATH=$HOME/my/share/man:$MANPATH
#export LD_LIBRARY_PATH=$HOME/my/lib:$LD_LIBRARY_PATH
#export LDFLAGS="-L/usr/lib64 -L$HOME/my/lib $LDFLAGS"
#export CFLAGS="-I/usr/include/openssl $CFLAGS"
#export CPPFLAGS="-I$HOME/my/include $CPPFLAGS"

export EDITOR=vim
export DISPLAY=:0.0
if [ "$(uname)" = 'Darwin' ] ; then
    export http_proxy=""
    export https_proxy=""
    export PATH=/usr/local/opt/openssl/bin:$PATH
fi
export CLICOLOR=1
export LSCOLORS=DxGxcxdxCxegedabagacad
export LS_COLORS='no=00:fi=00:di=34:ow=34;40:ln=35:pi=30;44:so=35;44:do=35;44:bd=33;44:cd=37;44:or=05;37;41:mi=05;37;41:ex=01;31:*.cmd=01;31:*.exe=01;31:*.com=01;31:*.bat=01;31:*.reg=01;31:*.app=01;31:*.txt=32:*.org=32:*.md=32:*.mkd=32:*.h=32:*.hpp=32:*.c=32:*.C=32:*.cc=32:*.cpp=32:*.cxx=32:*.objc=32:*.cl=32:*.sh=32:*.bash=32:*.csh=32:*.zsh=32:*.el=32:*.vim=32:*.java=32:*.pl=32:*.pm=32:*.py=32:*.rb=32:*.hs=32:*.php=32:*.htm=32:*.html=32:*.shtml=32:*.erb=32:*.haml=32:*.xml=32:*.rdf=32:*.css=32:*.sass=32:*.scss=32:*.less=32:*.js=32:*.coffee=32:*.man=32:*.0=32:*.1=32:*.2=32:*.3=32:*.4=32:*.5=32:*.6=32:*.7=32:*.8=32:*.9=32:*.l=32:*.n=32:*.p=32:*.pod=32:*.tex=32:*.go=32:*.sql=32:*.csv=32:*.sv=32:*.svh=32:*.v=32:*.vh=32:*.vhd=32:*.bmp=33:*.cgm=33:*.dl=33:*.dvi=33:*.emf=33:*.eps=33:*.gif=33:*.jpeg=33:*.jpg=33:*.JPG=33:*.mng=33:*.pbm=33:*.pcx=33:*.pdf=33:*.pgm=33:*.png=33:*.PNG=33:*.ppm=33:*.pps=33:*.ppsx=33:*.ps=33:*.svg=33:*.svgz=33:*.tga=33:*.tif=33:*.tiff=33:*.xbm=33:*.xcf=33:*.xpm=33:*.xwd=33:*.xwd=33:*.yuv=33:*.aac=33:*.au=33:*.flac=33:*.m4a=33:*.mid=33:*.midi=33:*.mka=33:*.mp3=33:*.mpa=33:*.mpeg=33:*.mpg=33:*.ogg=33:*.opus=33:*.ra=33:*.wav=33:*.anx=33:*.asf=33:*.avi=33:*.axv=33:*.flc=33:*.fli=33:*.flv=33:*.gl=33:*.m2v=33:*.m4v=33:*.mkv=33:*.mov=33:*.MOV=33:*.mp4=33:*.mp4v=33:*.mpeg=33:*.mpg=33:*.nuv=33:*.ogm=33:*.ogv=33:*.ogx=33:*.qt=33:*.rm=33:*.rmvb=33:*.swf=33:*.vob=33:*.webm=33:*.wmv=33:*.doc=31:*.docx=31:*.rtf=31:*.odt=31:*.dot=31:*.dotx=31:*.ott=31:*.xls=31:*.xlsx=31:*.ods=31:*.ots=31:*.ppt=31:*.pptx=31:*.odp=31:*.otp=31:*.fla=31:*.psd=31:*.7z=1;35:*.apk=1;35:*.arj=1;35:*.bin=1;35:*.bz=1;35:*.bz2=1;35:*.cab=1;35:*.deb=1;35:*.dmg=1;35:*.gem=1;35:*.gz=1;35:*.iso=1;35:*.jar=1;35:*.msi=1;35:*.rar=1;35:*.rpm=1;35:*.tar=1;35:*.tbz=1;35:*.tbz2=1;35:*.tgz=1;35:*.tx=1;35:*.war=1;35:*.xpi=1;35:*.xz=1;35:*.z=1;35:*.Z=1;35:*.zip=1;35:*.ANSI-30-black=30:*.ANSI-01;30-brblack=01;30:*.ANSI-31-red=31:*.ANSI-01;31-brred=01;31:*.ANSI-32-green=32:*.ANSI-01;32-brgreen=01;32:*.ANSI-33-yellow=33:*.ANSI-01;33-bryellow=01;33:*.ANSI-34-blue=34:*.ANSI-01;34-brblue=01;34:*.ANSI-35-magenta=35:*.ANSI-01;35-brmagenta=01;35:*.ANSI-36-cyan=36:*.ANSI-01;36-brcyan=01;36:*.ANSI-37-white=37:*.ANSI-01;37-brwhite=01;37:*.log=01;32:*~=01;32:*#=01;32:*.bak=01;33:*.BAK=01;33:*.old=01;33:*.OLD=01;33:*.org_archive=01;33:*.off=01;33:*.OFF=01;33:*.dist=01;33:*.DIST=01;33:*.orig=01;33:*.ORIG=01;33:*.swp=01;33:*.swo=01;33:*,v=01;33:*.gpg=34:*.gpg=34:*.pgp=34:*.asc=34:*.3des=34:*.aes=34:*.enc=34:*.sqlite=34:';

# zoxide
command -v zoxide 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "zoxide isn't installed: my-zoxideinstall";
    function my-zoxideinstall() {
        comexec "curl -sS https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | bash" || return
    }
else
    eval "$(zoxide init zsh)"
fi


# go
command -v go 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "go isn't installed: run my-goinstall"
    function my-goinstall() {
        command -v lsb_release 2>/dev/null 1>&2
        if [[ $? -ne 0 ]] ; then
            echo "Install manually."
            return
        fi
        lsb_release -a 2>&1 | grep -q Ubuntu
        if [[ $? -ne 0 ]] ; then
            echo "Install manually."
            return
        fi
        comexec "sudo add-apt-repository ppa:longsleep/golang-backports" || return
        comexec "sudo apt update" || return
        comexec "sudo apt install golang-go" || return
    }
else
    #cached_eval "go env"
    export GOPATH=${HOME}/go
    export PATH=${GOPATH}/bin:$PATH
fi

# flutter
export PATH=$PATH:$HOME/development/flutter/bin
export PATH=$PATH:$HOME/flutter/bin

# Android
if [[ -e $HOME/Library/Android/sdk ]] ; then
    export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools
fi

# LESS
# http://qiita.com/delphinus/items/b04752bb5b64e6cc4ea9
export LESS="-R -M -i -W -x4"
export LESSGLOBALTAGS=global
if command -v lesspipe.sh > /dev/null; then
    export LESSOPEN='| /usr/bin/env lesspipe.sh %s 2>&-'
fi

# gh cli
command -v gh 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "gh isn't installed: my-ghinstall"
    function my-ghinstall() {
        comexec "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg"
        comexec 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null'
        comexec "sudo apt update"
        comexec "sudo apt install gh" || return
    }
else
    cached_eval "gh completion -s zsh"
    alias ghprd='gh pr create --draft --fill'
fi

# lazygit
command -v lazygit 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "lazygit isn't installed: my-lazygitinstall-by-xxx"
    function my-lazygitinstall-by-go() {
        comexec "go install github.com/jesseduffield/lazygit@latest" || return
    }
    function my-lazygitinstall-by-apt() {
        comexec "sudo add-apt-repository ppa:lazygit-team/release" || return
        comexec "sudo apt-get update" || return
        comexec "sudo apt-get install lazygit" || return
    }
    function my-lazygitinstall-by-brew() {
        comexec "$MAC_INSTALLER lazygit"
    }
else
    alias lg='lazygit'
fi

# lazydocker
command -v lazydocker 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "lazydocker isn't installed: my-lazydockerinstall-by-xxx"
    function my-lazydockerinstall-by-go() {
        comexec "go install github.com/jesseduffield/lazydocker@latest" || return
    }
    function my-lazydockerinstall-by-apt() {
        comexec "sudo add-apt-repository ppa:lazydocker-team/release" || return
        comexec "sudo apt-get update" || return
        comexec "sudo apt-get install lazydocker" || return
    }
    function my-lazydockerinstall-by-brew() {
        comexec "$MAC_INSTALLER lazydocker"
    }
else
    alias ldo='lazydocker'
fi

# git-secrets
command -v git-secrets 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "git-secrets isn't installed: my-git-secretsinstall"
    function my-git-secretsinstall() {
        workdir=$(mktemp -d)
        comexec "git clone --depth 1 https://github.com/awslabs/git-secrets $workdir" || return
        comexec "pushd $workdir" || return
        comexec "sudo make install" || return
    }
fi

# hyperfine
command -v hyperfine 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "hyperfine benchmark tool isn't installed: my-hyperfineinstall"
    function my-hyperfineinstall() {
        if $MAC; then
            brew install hyperfine
        else
            downloadurl=$(curl https://api.github.com/repos/sharkdp/hyperfine/releases | jq '.[0].assets[] | select(.name | test("hyperfine_.+amd64.deb")) | .browser_download_url' -r )
            comexec "wget $downloadurl" || return
            filename=${downloadurl##*/}
            comexec "sudo dpkg -i $filename" || return
            comexec "rm -f $filename" || return
        fi
    }
fi

# asciinema
command -v asciinema 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "asciinema isn't installed: my-asciinemainstall"
    function my-asciinemainstall() {
        comexec "sudo apt-add-repository ppa:zanchey/asciinema"
        comexec "sudo apt-get update"
        comexec "sudo apt-get install asciinema"
    }
fi


if [ -e /usr/share/zsh/site-functions/ ]; then
    fpath=(/usr/share/zsh/sites-functions $fpath)
fi
if [ -e /opt/homebrew/share/zsh/site-functions ]; then
    fpath=(/opt/homebrew/share/zsh/site-functions $fpath)
fi


## zsh-completions
#if [ -e /usr/local/share/zsh-completions ]; then
#    fpath=(/usr/local/share/zsh-completions $fpath)
#elif [ -e ${ZDOTDIR:-$HOME}/.zsh-completions ]; then
#    fpath=(${ZDOTDIR:-$HOME}/.zsh-completions $fpath)
#else
#    git clone https://github.com/zsh-users/zsh-completions ${ZDOTDIR:-$HOME}/.zsh-completions
#    fpath=(${ZDOTDIR:-$HOME}/.zsh-completions $fpath)
#fi

setopt correct
setopt no_beep
setopt hist_no_store

# Alias
## Security
command -v socket 2>/dev/null 1>&2
if [[ $? -eq 0 ]] ; then
  alias npm="socket npm"
  alias npx="socket npx"
fi
alias serena="uvx --from git+https://github.com/oraios/serena serena start-mcp-server"
alias marp="npx @marp-team/marp-cli@latest"
alias wrangler="npx wrangler@latest"
alias ncu="npx npm-check-updates"
alias ezsh="$EDITOR ~/.zshrc"
alias reload='exec $SHELL'
alias :q='exit'
alias dcd='cd ~/dotfiles'
alias dotpl='cd ~/dotfiles; git pull --rebase; cd -'
alias rsync='noglob rsync --exclude-from=${HOME}/.config/rsync/exclude'
alias history='history -i'
alias c.='cd ..'
alias ls='ls -F --color'
alias ll='ls -l'
alias la='ls -la'
alias vi='vim'
alias c='clear'
alias ap='ansible-playbook'
if $MAC; then
    alias ftpsv='launchctl load -w /System/Library/LaunchDaemons/ftp.plist'
    alias ftpsvstop='launchctl unload -w /System/Library/LaunchDaemons/ftp.plist'
fi
alias gf='terragrunt'
alias gfa='terragrunt apply'
alias gfp='terragrunt plan'
alias gfd='terragrunt destroy'
alias gfi='terragrunt import'
alias gfw='terragrunt workspace'
alias gfwl='terragrunt workspace list'
alias gfws='terragrunt workspace select'
alias gfi='terragrunt import'
if $MAC; then
  alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
fi
alias ts="tailscale"
alias bins='bundle install'
alias be='bundle exec'
alias browsh='docker run --rm -it browsh/browsh'
alias dpython='docker run --workdir=/work -v$PWD:/work --rm -it python:3.13-slim bash'
alias dphp='docker run --workdir=/work -v$PWD:/work --rm -it php:8.2-cli bash'
alias clswp='rm -rf ~/.vim/swp/*'
alias nanounixt='date +%s%3N'
alias unixt='date +%s'
alias simpleserver='(){python -m http.server $1}'
alias fb='firebase'
alias dcomposer='docker run --rm -it -v $PWD:/app composer'
alias diskbench='dd if=/dev/zero bs=1024k of=tstfile count=1024'
function create-laravel-dev-container() {
    dir=${1:-laravel-example}
    if [ -e $dir ]; then
        echo "$dir already exists."
        return 1
    fi
    curl -s "https://laravel.build/laravel-example?with=mysql,redis&devcontainer" | bash
    code $dir
}
alias laraveldevcontainer='create-laravel-dev-container'

function aws-list-ec2() {
    aws ec2 describe-instances --query 'Reservations[].Instances[] | [][{Name: Tags[?Key==`Name`].Value, Id: InstanceId}]' --output json | jq -r '.[] | .[] | "\(.Name):\(.Id)"' | sort
}

function zipp() {
    DIR="$1"
    DIR="${DIR%/}"
    command rm -f "${DIR}.zip"
    command zip -r "${DIR}.zip" "$DIR" -x "*.DS_Store"
}
function ppap() {
    PASSWORD=`openssl rand -base64 9`
    FILENAME=${1%.*}
    command rm -f "${FILENAME}.zip"
    command zip -P "${PASSWORD}" -r "${FILENAME}.zip" "$1" -x "*.DS_Store"
    echo "[パスワード]"
    echo "$PASSWORD"
}
function md5check() {
    if [ -z "$1" ] || [ -z "$2" ]; then echo "usage: md5check dir1 dir2"; return 1; fi
    diff <(find "$1" -maxdepth 1 -type f | xargs md5sum | sed -e 's@/.*/@@g') <(find "$2" -maxdepth 1 -type f | xargs md5sum | sed -e 's@/.*/@@g')
}

## Claude Code
if [[ -f $HOME/.claude/local/claude ]] ; then
  export PATH="/Users/kesoji/.claude/local:$PATH"
  alias clc="claude"
  alias cla="claude"
fi

## Terraform
command -v terraform 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "terraform isn't installed: install it"
else
    alias tf='terraform'
    alias tfa='terraform apply'
    alias tfap='terraform apply --parallelism=50'
    alias tfanor='terraform apply -refresh=false'
    alias tfp='terraform plan'
    alias tfpp='terraform plan --parallelism=50'
    alias tfpnor='terraform plan -refresh=false'
    alias tfd='terraform destroy'
    alias tfi='terraform import'
    alias tfw='terraform workspace'
    alias tfwl='terraform workspace list'
    alias tfws='terraform workspace select'
    alias tfi='terraform import'
fi

## AWS CLI
command -v aws 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "awscli isn't installed: my-awscliinstall"
    function my-awscliinstall() {
        if $MAC; then
            comexec "$MAC_INSTALLER awscli"
        else
            comexec "curl -L https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o awscliv2.zip"
            comexec "unzip awscliv2.zip -d ./awstemp"
            comexec "sudo ./awstemp/aws/install"
            comexec "rm -rf ./awstemp awscliv2.zip"
        fi
    }
else
    command -v aws_completer 2>/dev/null 1>&2
    if [[ $? -ne 0 ]] ; then
        echo_error "aws is installed but aws_completer not found. why!?"
    else
        complete -C aws_completer aws
    fi
fi

## Docker
command -v docker 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "docker isn't installed: my-dockerinstall (CURRENTLY ONLY IN UBUNTU)"
    function my-dockerinstall() {
        comexec "sudo apt-get update"
        comexec "sudo apt-get install apt-transport-https ca-certificates curl software-properties-common"
        comexec "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -"
        comexec "sudo apt-key fingerprint 0EBFCD88"
        comexec "sudo add-apt-repository \"deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable\""
        comexec "sudo apt-get update"
        comexec "sudo apt-get install docker-ce docker-compose"
        comexec "sudo usermod -aG docker $USER"
        #comexec "mkdir -p ~/.zsh/completions"
        #comexec "curl -L https://raw.githubusercontent.com/docker/compose/$DOCKER_COMPOSE_VERSION/contrib/completion/zsh/_docker-compose > ~/.zsh/completions/_docker-compose"
    }
else
    alias drmca='docker ps -aq | xargs docker rm'
    alias drmia='docker images -aq | xargs docker rmi'
    alias dco='docker compose'
    alias dcolf='docker compose logs -f'
fi

## Git
alias gst='git status'
alias ga='git add'
alias gp='git push'
alias gpl='git pull'
function gwt() {
    GIT_CDUP_DIR=`git rev-parse --show-cdup`
    git worktree add ${GIT_CDUP_DIR}git-worktrees/$1 -b $1
}

## Global Alias
alias -g L='| less'
alias -g H='| head'
alias -g G='| grep'
alias -g GI='| grep -ri'
## auto expand
globalias() {
    if [[ $LBUFFER =~ ' [A-Z0-9]+$' ]]; then
        zle _expand_alias
    fi
    zle self-insert
}
zle -N globalias
bindkey " " globalias

## SSH
function cssh() {
    ssh $*
    tmux selectp -P 'fg=default,bg=default'
}
alias ssh='cssh '

# fzf
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
command -v fzf 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "fzf isn't installed: my-fzfinstall"
    function my-fzfinstall() {
        comexec "git clone https://github.com/junegunn/fzf.git ~/.fzf" || return
        comexec "~/.fzf/install" || return
    }
else
    source <(fzf --zsh)
    command -v rg 2>/dev/null 1>&2
    if [[ $? -eq 0 ]] ; then
        export FZF_DEFAULT_COMMAND='rg --files --hidden --glob "!.git"'
        export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
        export FZF_ALT_C_COMMAND="$FZF_DEFAULT_COMMAND"
        export FZF_DEFAULT_OPTS='--height 40% --reverse --border'
        #'--color fg:242,bg:236,hl:65,fg+:15,bg+:239,hl+:108
        #--color info:108,prompt:109,spinner:108,pointer:168,marker:168
        #'
    else
        echo_info "ripgrep(rg) isn't installed: my-rginstall"
        function my-rginstall() {
            if $MAC; then
                comexec "brew install ripgrep" || return
            else
                comexec "sudo apt-get install ripgrep" || return
            fi
        }
    fi
fi

# disable STOP (Ctrl+S)
[ -t 0 ] && stty stop undef

# pet
if `command -v pet 2>/dev/null 1>&2` ; then
    function prev() {
        PREV=$(fc -lrn | head -n 1)
        sh -c "pet new `printf %q "$PREV"`"
    }
    function pet-select() {
        BUFFER=$(pet search --query "$LBUFFER")
        CURSOR=$#BUFFER
        zle redisplay
    }
    zle -N pet-select
    bindkey '^s' pet-select
fi

## textlint setup
function my-textlintsetup() {
    comexec "npm i -g textlint textlint-rule-preset-ja-technical-writing"
}

# kubectl completion
command -v kubectl 2>/dev/null 1>&2
if [[ $? -eq 0 ]] ; then
    source <(kubectl completion zsh)
fi


function my-colortable (){
    for i in {0..255}; do
        printf "\x1b[38;5;${i}mcolour${i}\x1b[0m\n";
    done | xargs
}
function my-colortable2() {
    for fore in `seq 30 37`; do
        printf "\e[${fore}m \\\e[${fore}m \e[m\n";
        for mode in 1 4 5; do
            printf "\e[${fore};${mode}m \\\e[${fore};${mode}m \e[m";
            for back in `seq 40 47`; do
                printf "\e[${fore};${back};${mode}m \\\e[${fore};${back};${mode}m \e[m";
            done
            echo
        done
        echo
    done
    printf " \\\e[m\n"
}

command -v gibo 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "gibo isn't installed: my-giboinstall"
    function my-giboinstall (){
        comexec "go install github.com/simonwhitaker/gibo@latest"
        gibo update
    }
fi

# Ctrl-z switch back
function switch-back-ctrl-z () {
    if [[ $#BUFFER -eq 0 ]]; then
        BUFFER="fg"
        zle accept-line
    else
        zle push-input
        zle clear-screen
    fi
}
zle -N switch-back-ctrl-z
bindkey '^z' switch-back-ctrl-z

# ghq
command -v ghq 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "ghq isn't installed: my-ghqinstall"
    function my-ghqinstall (){
        comexec "go install github.com/x-motemen/ghq@latest" || return
    }
else
    export GHQ_ROOT="${GOPATH:-$HOME/go}/src"
    alias g='cd $(ghq root)/$(ghq list | fzf)'

    # CTRL-G - Paste ghq path into the command line
    __fghq() {
      local rootdir="$(ghq root)"
      setopt localoptions pipefail 2> /dev/null
      local repodir="$(ghq list | fzf)"
      local dir="$rootdir/$repodir/"
      echo $dir
    }

    fzf-ghq-widget() {
      LBUFFER="${LBUFFER}$(__fghq)"
      local ret=$?
      zle reset-prompt
      return $ret
    }
    zle     -N   fzf-ghq-widget
    bindkey '^G' fzf-ghq-widget

    alias ghq-status='for i in `ghq list`; do echo "======== $i ========"; cd $(ghq root)/$i; git status -s; popd; done'

fi

# fd-find
command -v fdfind 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    command -v fd 2>/dev/null 1>&2
    if [[ $? -ne 0 ]] ; then
        echo_info "fd isn't installed: my-fdinstall"
        function my-fdinstall() {
            if $MAC; then
                comexec "$MAC_INSTALLER fd"
            else
                comexec "sudo apt install fd-find"
            fi
        }
    fi
else
    alias fd='fdfind'
fi

# ffmpeg
ffmpeg_compress720p() {
    local input="$1"
    if [[ -z "$input" ]]; then
        echo "Usage: $0 <input_file>"
        return 1
    fi
    
    if [[ ! -f "$input" ]]; then
        echo "Error: File '$input' not found"
        return 1
    fi
    
    local output="${input%.*}_720p_2mbps.${input##*.}"
    
    ffmpeg -i "$input" \
        -vf "scale=min(1280\,iw):min(720\,ih):force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
        -c:v libx264 -b:v 2M -maxrate 2M -bufsize 4M \
        -c:a aac -b:a 128k \
        "$output"
}


# atcoder-tools
command -v atcoder-tools 2>/dev/null 1>&2
if [[ $? -eq 0 ]] ; then
    alias atc='atcoder-tools'
fi

function commandinstalled() {
    command -v ${1%:*} 2>/dev/null 1>&2
    if [[ $? -eq 0 ]]; then
        echo -e "$1: \e[37;42;1minstalled\e[m"
    else
        echo -e "$1: \e[30;41;1mnot installed\e[m"
    fi
}

function commandinstalled_withdesc() {
    com=${1%%|*}
    desc=${1##*|}
    echo -n "$com: "
    command -v $com 2>/dev/null 1>&2
    if [[ $? -eq 0 ]]; then
        echo -en "\e[37;42;1minstalled\e[m"
    else
        echo -en "\e[30;41;1mnot installed\e[m"
    fi
    echo " [$desc]"
}

#
# Defines transfer alias and provides easy command line file and folder sharing.
#
# Authors:
#   Remco Verhoef <remco@dutchcoders.io>
#

curl --version 2>&1 > /dev/null
if [ $? -ne 0 ]; then
    echo "transfer.sh: Could not find curl."
else
    transfer() {
        # Authors:
        #   Remco Verhoef <remco@dutchcoders.io>
        # check arguments
        if [ $# -eq 0 ]; then
            echo "No arguments specified. Usage:\necho transfer /tmp/test.md\ncat /tmp/test.md | transfer test.md"
            return 1
        fi

        ADDITIONAL_HEADER=""
        if [ "$2" = "MAX1" ]; then
            ADDITIONAL_HEADER='-H "Max-Downloads: 1" -H "Max-Days: 1"'
            echo "koko";
        fi

        # get temporarily filename, output is written to this file show progress can be showed
        tmpfile=$( mktemp -t transferXXX )

        # upload stdin or file
        file=$1

        if tty -s;
        then
            basefile=$(basename "$file" | sed -e 's/[^a-zA-Z0-9._-]/-/g')

            if [ ! -e $file ];
            then
                echo "File $file doesn't exists."
                return 1
            fi

            if [ -d $file ];
            then
                # zip directory and transfer
                zipfile=$( mktemp -t transferXXX.zip )
                cd $(dirname $file) && zip -r -q - $(basename $file) >> $zipfile
                curl --progress-bar $ADDITIONAL_HEADER --upload-file "$zipfile" "https://transfer.sh/$basefile.zip" >> $tmpfile
                rm -f $zipfile
            else
                # transfer file
                curl --progress-bar $ADDITIONAL_HEADER --upload-file "$file" "https://transfer.sh/$basefile" >> $tmpfile
                echo curl --progress-bar $ADDITIONAL_HEADER --upload-file "$file" "https://transfer.sh/$basefile" >> $tmpfile
            fi
        else
            # transfer pipe
            curl --progress-bar $ADDITIONAL_HEADER --upload-file "-" "https://transfer.sh/$file" >> $tmpfile
        fi

        # cat output link
        cat $tmpfile
        echo

        # cleanup
        rm -f $tmpfile
    }

    transfer1() {
        transfer $1 "MAX1"
    }
fi

test -e "${HOME}/.iterm2_shell_integration.zsh" && source "${HOME}/.iterm2_shell_integration.zsh"


# if bash rename "handler" to "handle"
#command_not_found_handler() {
#    ####
#    # 変数の定義
#    ####
#    # 変数(ASCII ART)定義
#    AA1="
#        ＿＿＿_
#      ／ ＼  ／＼ ｷﾘｯ
#     ／（ー）（ー)＼
#    ／⌒（__人__）⌒＼     「$1」、
#    |     |r┬-|     |
#     ＼    \`ー'´  ／
#     ノ         ＼
#     ／´            ヽ
#    | ｌ              ＼
#    ヽ -''\"~｀\`'ー-､ -一'''''ー-､.
#   ヽ ＿＿(⌒)(⌒)⌒) ) (⌒＿(⌒)⌒)⌒))"
#
#    AA2_1="
#           ＿＿＿＿
#        ／_ノ  ヽ､＼
# ﾐ ﾐ ﾐ  oﾟ((●)) ((●))ﾟo      ﾐ ﾐ ﾐ
# /⌒) ⌒) ⌒.::⌒（__人__）⌒:::    /⌒ )⌒ )⌒)
#| / / /     |r┬-|    | (⌒)/ / / /／  だっておｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗ
#| :::::::(⌒)   | | |   ／  ゝ ::::::/   そんなコマンドないおｗｗｗｗｗｗｗｗｗｗｗｗｗ
#|     ノ    | | |   ＼  / )   /
#ヽ    /     \`ー'´    ヽ  /    ／      バ
# |    |  l|l        l||l 从 ノ    バ   ン
# ヽ    -''\"~｀\`'ー-､    -一'''''ー-､    ン
#  ヽ ＿＿          ＿＿／"
#
#    AA2_2="
#          ＿＿＿＿
#        ／_ノ  ヽ､＼
# ﾐ ﾐ ﾐ  oﾟ((●)) ((●))ﾟo      ﾐ ﾐ ﾐ
# /⌒) ⌒) ⌒.::⌒（__人__）⌒:::    /⌒ )⌒ )⌒)
#| / / /     |r┬-|    | (⌒)/ / / /／  だっておｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗ
#| :::::::(⌒)   | | |   ／  ゝ ::::::/   そんなコマンドないおｗｗｗｗｗｗｗｗｗｗｗｗｗ
#|     ノ    | | |   ＼  / )   /
#ヽ    /     \`ー'´    ヽ  /    ／     バ
# |    |  l|l 从人 l|l   l||l 从 人 l|l  バ   ン
# ヽ    -''\"~｀\`'ー-､    -一'''''ー-､    ン
#  ヽ ＿＿＿＿(⌒)(⌒)⌒) )    (⌒＿(⌒)⌒)⌒))"
#
#    AA2_3="
#          ＿＿＿＿
#        ／_ノ  ヽ､＼
#       oﾟ((●)) ((●))ﾟo
#      ／:::⌒（__人__）⌒:::
#     |     |r┬-|     |          だっておｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗ
#     ＼    | | |   ／           そんなコマンドないおｗｗｗｗｗｗｗｗｗｗｗｗｗ
#      ノ    | | |   ＼
#    ／´     \`ー'´    ヽ           バ
#    | |            ＼        バ   ン
#    ヽ  -''\"~｀\`'ー-､    -一'''''ー-､    ン
#    ヽ ＿＿(⌒)(⌒)⌒) )    (⌒＿(⌒)⌒)⌒))"
#
#
#    AA_NUM_MIN=1
#    AA_NUM_MAX=3
#    COUNT=20
#    SUFFIX="AA2_"
#
#    # if you want to disable Ctrl-C, comment-in
#    #trap '' 1 2 3 4 5 15
#
#
#    ####
#    # メインの処理
#    ####
#    # 最初のAA(AA1)の出力
#    echo -e "$AA1"
#    sleep 1
#
#    # COUNT分のループ処理(AA2_1〜AA2_3の出力)
#    LINE=$(echo -e "${AA1}"|wc -l)
#    NUM=${AA_NUM_MIN}
#    until [ ${COUNT} -eq 0 ];
#    do
#        for i in $(seq 1 ${LINE});do
#            echo $'\e[1A' $'\e[1G' $'\e[2K' $'\e[1A'
#        done
#
#        eval echo \"\${${SUFFIX}${NUM}}\"
#        sleep 0.1
#
#        LINE=$(eval echo -e \"\${${SUFFIX}${NUM}}\"|wc -l)
#        NUM=$((${NUM} + 1))
#        if [ ${NUM} -gt ${AA_NUM_MAX} ];then
#            NUM=${AA_NUM_MIN}
#        fi
#
#        COUNT=$((COUNT - 1))
#    done
#
#    return 1
#}


complete-ssh-host-fzf() {
    local host="$(egrep -i '^Host\s+.+' ~/.ssh/config $(find ~/.ssh/conf.d -type f 2>/dev/null) | egrep -v '[*?]' | awk '{print $2}' | sort | fzf)"

    [ ! -z "$host" ] && LBUFFER+="$host"
    zle reset-prompt
}
zle -N complete-ssh-host-fzf
bindkey '^s^s' complete-ssh-host-fzf


autoload -U +X bashcompinit && bashcompinit
complete -o nospace -C terraform terraform

export PATH="/opt/homebrew/opt/openjdk@11/bin:$PATH"

# tabtab source for packages
# uninstall by removing these lines
[[ -f ~/.config/tabtab/__tabtab.zsh ]] && . ~/.config/tabtab/__tabtab.zsh || true

# PROFILING .zshenvから `zmodload zsh/zprof && zprof` をコメントインするとプロファイリングできる
if (which zprof > /dev/null) ;then
  zprof | less
fi

if [[ -e /usr/libexec/java_home ]]; then
    JAVAHOME=$(/usr/libexec/java_home -v 21 2>/dev/null)
    if [[ $? -eq 0 ]]; then
        echo_info "Setting JAVA_HOME to $JAVAHOME"
        export JAVA_HOME=$(/usr/libexec/java_home -v 21)
        export PATH=$JAVA_HOME/bin:$PATH
    fi
fi

#THIS MUST BE AT THE END OF THE FILE FOR SDKMAN TO WORK!!!
#export SDKMAN_DIR="$HOME/.sdkman"
#[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"
export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
export PATH="/opt/homebrew/lib/ruby/gems/3.2.0/bin:$PATH"


function 2ndapprove() {
    if [ -z "$1" ]; then
        echo "Usage: 2ndapprove <GitHub PR URL> [<Comment>]"
        return 1
    fi

    # Extract repository info and PR number from URL
    local pr_url="$1"
    local approve_comment="$2"
    local repo_info
    local pr_number
    
    # Handle both full PR URLs and PR file URLs (/files, /commits, etc.)
    if [[ "$pr_url" =~ github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
        local owner="${match[1]}"
        local repo="${match[2]}"
        pr_number="${match[3]}"
        repo_info="${owner}/${repo}"
    else
        echo "Error: Invalid GitHub PR URL format"
        return 1
    fi

    echo "Processing PR #${pr_number} in ${repo_info}..."

    # 1. Approve the PR
    echo "Approving PR..."
    gh pr review "$pr_number" --repo "$repo_info" --approve || {
        echo "Error: Failed to approve PR"
        return 1
    }

    # 2. Get PR author and current assignees info
    local pr_data
    pr_data=$(gh pr view "$pr_number" --repo "$repo_info" --json author,assignees,labels) || {
        echo "Error: Failed to get PR data"
        return 1
    }

    local pr_author
    pr_author=$(echo "$pr_data" | jq -r '.author.login')

    # 3. Get all reviewers who have approved (excluding current user)
    local current_user
    current_user=$(gh api user --jq '.login')
    
    local approved_reviewers
    approved_reviewers=$(gh pr view "$pr_number" --repo "$repo_info" --json reviews | \
        jq -r --arg current_user "$current_user" \
        '.reviews[] | select(.state == "APPROVED" and .author.login != $current_user) | .author.login' | \
        sort -u | tr '\n' ' ')

    # 4. Remove all current assignees
    local current_assignees
    current_assignees=$(echo "$pr_data" | jq -r '.assignees[].login' | tr '\n' ',')
    current_assignees=${current_assignees%,}  # Remove trailing comma
    
    if [ -n "$current_assignees" ]; then
        echo "Removing current assignees: $current_assignees"
        gh pr edit "$pr_number" --repo "$repo_info" --remove-assignee "$current_assignees" || {
            echo "Warning: Failed to remove assignees"
        }
    fi

    # 5. Add PR author and approved reviewers as assignees
    local new_assignees="$pr_author"
    if [ -n "$approved_reviewers" ]; then
        # Convert space-separated to comma-separated
        local formatted_reviewers=$(echo "$approved_reviewers" | tr ' ' ',')
        new_assignees="$new_assignees,$formatted_reviewers"
    fi
    new_assignees=${new_assignees%,}  # Remove trailing comma
    
    if [ -n "$new_assignees" ]; then
        echo "Adding assignees: $new_assignees"
        gh pr edit "$pr_number" --repo "$repo_info" --add-assignee "$new_assignees" || {
            echo "Warning: Failed to add assignees"
        }
    fi

    # 6. Remove labels containing "2nd"
    local labels_to_remove
    labels_to_remove=$(echo "$pr_data" | jq -r '.labels[] | select(.name | contains("2nd")) | .name')
    
    if [ -n "$labels_to_remove" ]; then
        echo "Removing labels containing '2nd'..."
        while IFS= read -r label; do
            if [ -n "$label" ]; then
                gh pr edit "$pr_number" --repo "$repo_info" --remove-label "$label" || {
                    echo "Warning: Failed to remove label $label"
                }
            fi
        done <<< "$labels_to_remove"
    fi

    # 7. Add "CanBeMerged" label
    echo "Adding 'CanBeMerged' label..."
    gh pr edit "$pr_number" --repo "$repo_info" --add-label "CanBeMerged" || {
        echo "Warning: Failed to add 'CanBeMerged' label"
    }

    echo "✅ Successfully processed PR #${pr_number}"
}
[[ "$TERM_PROGRAM" == "kiro" ]] && . "$(kiro --locate-shell-integration-path zsh)"
export PATH=/Users/kesoji/.tiup/bin:$PATH

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/kesoji/.local/share/google-cloud-sdk/path.zsh.inc' ]; then . '/Users/kesoji/.local/share/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/Users/kesoji/.local/share/google-cloud-sdk/completion.zsh.inc' ]; then . '/Users/kesoji/.local/share/google-cloud-sdk/completion.zsh.inc'; fi
# The following lines have been added by Docker Desktop to enable Docker CLI completions.
fpath=(/Users/kesoji/.docker/completions $fpath)
autoload -Uz compinit
compinit
# End of Docker CLI completions

# Kiro CLI post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.post.zsh"
