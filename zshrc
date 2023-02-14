# Fig pre block. Keep at the top of this file.
[[ -f "$HOME/.fig/shell/zshrc.pre.zsh" ]] && builtin source "$HOME/.fig/shell/zshrc.pre.zsh"
if [ ~/.zshrc -nt ~/.zshrc.zwc ]; then
    zcompile ~/.zshrc
fi

function echo_error {
    echo -e "\e[31m$@\e[m"
}
function echo_notice {
    echo -e "\e[33;5;243m$@\e[m"
}
function echo_info {
    echo -e "\e[38;5;243m$@\e[m"
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
            echo "installing git lfs";
            brew install git-lfs
            git lfs install
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/coreutils" ]]; then
            echo_info "replace core commands from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnuman:$MANPATH"
        else
            echo_info "run brew install coreutils!"
        fi
        if [[ -e "$HOMEBREW_PREFIX/opt/grep" ]]; then
            echo_info "replace grep from BSD to GNU"
            export PATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnubin:$PATH"
            export MANPATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnuman:$MANPATH"
        else
            echo_info "run brew install grep!"
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
fi


export PATH=$HOME/.local/bin:$HOME/my/sbin:$HOME/my/bin:$PATH

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
    # run tmux avoiding nest / intellijはintellij側に設定する
    if [[ -z "$TMUX" && "$TERM_PROGRAM" != "vscode" && "$TERM_PROGRAM" != "intellij" ]]; then
        check=`tmux ls 2>&1`
        if [[ $? -eq 0 ]]; then
            if [[ -z $check ]]; then
                tmux -2
            else
                echo $check | grep -q "no session" && tmux -2 || tmux -2 a
            fi
        else
            tmux -2
        fi
    fi
fi

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

fpath=(~/.zsh/completions $fpath)
if [[ -s ~/.stripe/stripe-completion.zsh ]]; then
    fpath=(~/.stripe $fpath)
    autoload -Uz compinit && compinit -i
fi

HISTFILE=~/.zsh_history
HISTSIZE=20000
SAVEHIST=20000
setopt share_history
setopt histignorealldups
# fzf may override these settings
bindkey '^r' history-incremental-pattern-search-backward
bindkey '^s' history-incremental-pattern-search-forward

function comexec() {
    echo ">>> $1"; eval $1
}


# essentials
command -v make 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    if $WSL; then
        echo "I think this is first installation. Installing gcc, make..."
        comexec "sudo apt -y update"
        comexec "sudo apt -y install build-essential git unzip"
    fi
fi

# Source Prezto.
if [[ -s "${ZDOTDIR:-$HOME}/.zprezto/init.zsh" ]]; then
    source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"

    if [[ -z "${ZPREZTODIR}" ]]; then
        echo "whoops, something wrong with ZPREZTO. Env ZPREZTODIR isn't found."
    fi

    autoload -Uz promptinit
    promptinit
    prompt steeef
else
    # PROMPT
    autoload -U promptinit
    autoload -Uz colors && colors
    PROMPT="%{${fg[green]}%}[%n@%m]%{${reset_color}%} %~
    $ "
    # enable completion
    autoload -Uz compinit && compinit -u

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
fi

if [ ! -e ~/my/src/enhancd/init.sh ]; then
    echo_info "enhancd isn't installed: my-enhancdinstall"
    function my-enhancdinstall() {
        comexec "git clone https://github.com/b4b4r07/enhancd ~/my/src/enhancd"
        comexec "source ~/my/src/enhancd/init.sh"
    }
else
    source ~/my/src/enhancd/init.sh
fi

autoload -Uz bashcompinit && bashcompinit -i

# 20220213 zpreztoより前に置くなぜかおかしくなる
#set -o vi
set -o emacs

# 20220322 これは設定しちゃいけないらしい
#export TERM=xterm-256color
export XDG_CONFIG_HOME=$HOME/.config

export MANPATH=$HOME/my/share/man:$MANPATH
export LD_LIBRARY_PATH=$HOME/my/lib:$LD_LIBRARY_PATH
export LDFLAGS="-L/usr/lib64 -L$HOME/my/lib $LDFLAGS"
export CFLAGS="-I/usr/include/openssl $CFLAGS"
export CPPFLAGS="-I$HOME/my/include $CPPFLAGS"
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

# asdf
command -v asdf 2>/dev/null 1>&2
if [[ ! -e ~/.asdf ]] ; then
    echo_info "asdf isn't installed: let's visit http://asdf-vm.com/guide/getting-started.html#_3-install-asdf OR my-asdfinstall";
    function my-asdfinstall() {
        comexec "git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v0.9.0" || return
    }
else
    . $HOME/.asdf/asdf.sh
    fpath=(${ASDF_DIR}/completions $fpath)
    autoload -Uz compinit && compinit
    if [[ -e ~/.asdf/plugins/java/set-java-home.zsh ]]; then
        . ~/.asdf/plugins/java/set-java-home.zsh
    fi
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
    eval $(go env)
    export GOPATH=$HOME/go
    export PATH=${GOPATH}/bin:$PATH
fi

# flutter
export PATH=$PATH:$HOME/development/flutter/bin

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
    eval "$(gh completion -s zsh)"
fi

# bat
command -v bat 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "bat isn't installed: let's visit https://github.com/sharkdp/bat/releases and install!"
else
    alias cat='bat'
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
else
    alias lg='lazygit'
fi

# diff-highlight
if command -v diff-highlight >/dev/null ; then
    ln -sf ~/dotfiles/tigrc_diffhighlight ~/.tigrc
else
    echo_info "diff-highlight isn't installed: my-diff-highlightinstall"
    function my-diff-highlightinstall() {
        workdir="temp_git_diffhighlightinstall"
        comexec "git clone --depth 1 https://github.com/git/git $workdir" || return
        comexec "pushd $workdir/contrib/diff-highlight" || return
        comexec "make" || return
        comexec "sudo cp diff-highlight /usr/local/bin" || return
        comexec "popd; rm -rf $workdir" || return
    }
fi

# git-secrets
command -v git-secrets 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "git-secrets isn't installed: my-git-secretsinstall"
    function my-git-secretsinstall() {
        workdir="temp_git_gitsecretsinstall"
        comexec "git clone --depth 1 https://github.com/awslabs/git-secrets $workdir" || return
        comexec "pushd $workdir" || return
        comexec "sudo make install" || return
        comexec "popd; rm -rf $workdir" || return
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

# hexyl
command -v hexyl 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "hexyl (bindump tool) isn't installed: https://github.com/sharkdp/hexyl"
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

# direnv
command -v direnv 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "direnv isn't installed: my-direnvinstall"
    function my-direnvinstall {
        tmpdir=~/__direnv__tmp
        [[ -d $tmpdir ]] && comexec "rm -rf $tmpdir"
        comexec "git clone git@github.com:direnv/direnv.git $tmpdir" || return
        comexec "pushd $tmpdir" || return
        comexec "make" || return
        comexec "make install PREFIX=$HOME/my" || return
        comexec "popd; rm -rf $tmpdir" || return
    }
else
    eval "$(direnv hook zsh)"
fi

function myutils() {
    local -a ary=(
        "ncdu|Graphical du"
        "htop|Replacement for top"
    )
    for v in $ary; do
        commandinstalled_withdesc $v
    done
}

function mycheck() {
    my-php
    my-javascript
}

function my-javascript() {
    echo ">>> Javascript <<<"
    local -a ary=("yarn" "node" "tsc" "tsserver" "eslint")
    for v in $ary; do
        commandinstalled $v
    done
}

if [ -e /usr/share/zsh/site-functions/ ]; then
    fpath=(/usr/share/zsh/sites-functions $fpath)
fi
if [ -e /opt/homebrew/share/zsh/site-functions ]; then
    fpath=(/opt/homebrew/share/zsh/site-functions $fpath)
fi

# jump
command -v jump 2>/dev/null 1>&2
if [[ $? -eq 0 ]] ; then
    eval "$(jump shell)"
else
    echo_info "jump isn't installed"
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
alias bins='bundle install'
alias be='bundle exec'
alias browsh='docker run --rm -it browsh/browsh'
alias clswp='rm -rf ~/.vim/swp/*'
alias nanounixt='date +%s%3N'
alias unixt='date +%s'
alias simpleserver='python -m http.server 80'
alias fb='firebase'
alias dcomposer='docker run --rm -i --tty -v $PWD:/app composer'
function zipp() {
    DIR=$1
    command rm -f $DIR.zip
    command zip -r $DIR.zip $DIR -x "*.DS_Store"
}
function ppap() {
    PASSWORD=`openssl rand -base64 9`
    FILENAME=${1%.*}
    command zip -P "${PASSWORD}" -r "${FILENAME}.zip" "$1"
    echo "[パスワード]"
    echo "$PASSWORD"
}

## Terraform
command -v terraform 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "terraform isn't installed: use asdf to install"
else
    alias tf='terraform'
    alias tfa='terraform apply'
    alias tfanor='terraform apply -refresh=false'
    alias tfp='terraform plan'
    alias tfpnor='terraform plan -refresh=false'
    alias tfd='terraform destroy'
    alias tfi='terraform import'
    alias tfw='terraform workspace'
    alias tfwl='terraform workspace list'
    alias tfws='terraform workspace select'
    alias tfi='terraform import'
    export TF_CLI_ARGS_plan="--parallelism=40"
    export TF_CLI_ARGS_apply="--parallelism=40"
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

## saml2aws
command -v saml2aws 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "saml2aws isn't installed: my-saml2awsinstall"
    function my-saml2awsinstall() {
        if $MAC; then
            comexec "$MAC_INSTALLER saml2aws"
        else
            CURRENT_VERSION=$(curl -Ls https://api.github.com/repos/Versent/saml2aws/releases/latest | grep 'tag_name' | cut -d'v' -f2 | cut -d'"' -f1)
            comexec "wget -c https://github.com/Versent/saml2aws/releases/download/v${CURRENT_VERSION}/saml2aws_${CURRENT_VERSION}_linux_amd64.tar.gz -O - | tar -xzv -C ~/my/bin"
            comexec "chmod u+x ~/my/bin/saml2aws"
            comexec "hash -r"
        fi
    }
fi
alias saml2awsbrowser='SAML2AWS_IDP_PROVIDER=Browser saml2aws'


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
    alias dco='docker-compose'
    alias dcolf='docker-compose logs -f'
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

# Haskell
command -v stack 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "stack (Haskell) isn't installed: my-haskellstackinstall"
    function my-haskellstackinstall (){
        comexec "curl -sSL https://get.haskellstack.org/ | sh" || return
    }
else
    eval "$(stack --bash-completion-script stack)"
    alias ghci='stack ghci'
    alias ghc='stack ghci --'
    alias runghc='stack runghc --'
fi

# Rust
if [[ ! -e $HOME/.cargo ]] ; then
    echo_info "Cargo(Rust) isn't installed: my-rustinstall"
    function my-rustinstall (){
        comexec "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" || return
    }
fi

command -v gibo 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "gibo isn't installed: my-giboinstall"
    function my-giboinstall (){
        comexec "mkdir -p ~/my/bin" || return
        comexec "curl -L https://raw.github.com/simonwhitaker/gibo/master/gibo -so ~/my/bin/gibo" || return
        comexec "chmod +x ~/my/bin/gibo && ~/my/bin/gibo update" || return
        echo "install finished"
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
    if [ ! -z $ENHANCD_ROOT ]; then
        alias g='cd -G'
    fi

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

# Krypton
command -v kr 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo_info "krypton isn't installed: my-kryptoninstall"
    function my-kryptoninstall (){
        if [[ "$(uname -a)" =~ "Microsoft" ]]; then
            comexec "go get github.com/kryptco/kr" || return
            comexec "pushd ~/go/src/github.com/kryptco/kr && make install && kr restart" || return
            comexec "popd" || return
        else
            comexec "curl https://krypt.co/kr | sh" || return
        fi

        if [ "$(uname)" != 'Darwin' ] ; then
            comexec "sudo mkdir -p /usr/local/lib" || return
            comexec "sudo ln -s /usr/lib/kr-pkcs11.so /usr/local/lib/kr-pkcs11.so" || return
            comexec "sudo mkdir -p /usr/local/bin" || return
            comexec "sudo ln -s /usr/bin/krssh /usr/local/bin/krssh" || return
        fi
    }
fi

# php
function my-php() {
    echo ">>> PHP <<<"
    local -a ary=("composer" "phpstan:phpstan/phpstan" "phpcbf:squizlabs/PHP_CodeSniffer" "psysh:psy/psysh")
    for v in $ary; do
        commandinstalled $v
    done
}

command -v composer 2>/dev/null 1>&2
if [[ $? -ne 0 ]]; then
    echo_info "composer isn't installed: my-composerinstall"
    function my-composerinstall() {
        echo 'getting signature'
        EXPECTED_SIGNATURE="$(wget -q -O - https://composer.github.io/installer.sig)"
        echo 'got signature ' $EXPECTED_SIGNATURE
        comexec "php -r \"copy('https://getcomposer.org/installer', 'composer-setup.php');\""
        echo 'checking signature'
        ACTUAL_SIGNATURE="$(php -r "echo hash_file('sha384', 'composer-setup.php');")"
        echo 'got signature ' $ACTUAL_SIGNATURE

        if [ "$EXPECTED_SIGNATURE" != "$ACTUAL_SIGNATURE" ]
        then
            echo 'ERROR: Invalid installer signature'
            comexec "rm composer-setup.php" || return
            return
        fi

        comexec "php composer-setup.php --quiet --install-dir=$HOME/my/bin --filename=composer" || return
        comexec "rm -f composer-setup.php" || return
    }
else
    export PATH=$HOME/.config/composer/vendor/bin:$PATH
fi

# fd-find
command -v fdfind 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    command -v fd 2>/dev/null 1>&2
    if [[ $? -ne 0 ]] ; then
        echo_info "fd isn't installed: my-fdinstall"
        function my-fdinstall() {
            comexec "sudo apt install fd-find" || return
        }
    fi
else
    alias fd='fdfind'
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
command_not_found_handler() {
    ####
    # 変数の定義
    ####
    # 変数(ASCII ART)定義
    AA1="
        ＿＿＿_
      ／ ＼  ／＼ ｷﾘｯ
     ／（ー）（ー)＼
    ／⌒（__人__）⌒＼     「$1」、
    |     |r┬-|     |
     ＼    \`ー'´  ／
     ノ         ＼
     ／´            ヽ
    | ｌ              ＼
    ヽ -''\"~｀\`'ー-､ -一'''''ー-､.
   ヽ ＿＿(⌒)(⌒)⌒) ) (⌒＿(⌒)⌒)⌒))"

    AA2_1="
           ＿＿＿＿
        ／_ノ  ヽ､＼
 ﾐ ﾐ ﾐ  oﾟ((●)) ((●))ﾟo      ﾐ ﾐ ﾐ
 /⌒) ⌒) ⌒.::⌒（__人__）⌒:::    /⌒ )⌒ )⌒)
| / / /     |r┬-|    | (⌒)/ / / /／  だっておｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗ
| :::::::(⌒)   | | |   ／  ゝ ::::::/   そんなコマンドないおｗｗｗｗｗｗｗｗｗｗｗｗｗ
|     ノ    | | |   ＼  / )   /
ヽ    /     \`ー'´    ヽ  /    ／      バ
 |    |  l|l        l||l 从 ノ    バ   ン
 ヽ    -''\"~｀\`'ー-､    -一'''''ー-､    ン
  ヽ ＿＿          ＿＿／"

    AA2_2="
          ＿＿＿＿
        ／_ノ  ヽ､＼
 ﾐ ﾐ ﾐ  oﾟ((●)) ((●))ﾟo      ﾐ ﾐ ﾐ
 /⌒) ⌒) ⌒.::⌒（__人__）⌒:::    /⌒ )⌒ )⌒)
| / / /     |r┬-|    | (⌒)/ / / /／  だっておｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗ
| :::::::(⌒)   | | |   ／  ゝ ::::::/   そんなコマンドないおｗｗｗｗｗｗｗｗｗｗｗｗｗ
|     ノ    | | |   ＼  / )   /
ヽ    /     \`ー'´    ヽ  /    ／     バ
 |    |  l|l 从人 l|l   l||l 从 人 l|l  バ   ン
 ヽ    -''\"~｀\`'ー-､    -一'''''ー-､    ン
  ヽ ＿＿＿＿(⌒)(⌒)⌒) )    (⌒＿(⌒)⌒)⌒))"

    AA2_3="
          ＿＿＿＿
        ／_ノ  ヽ､＼
       oﾟ((●)) ((●))ﾟo
      ／:::⌒（__人__）⌒:::
     |     |r┬-|     |          だっておｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗｗ
     ＼    | | |   ／           そんなコマンドないおｗｗｗｗｗｗｗｗｗｗｗｗｗ
      ノ    | | |   ＼
    ／´     \`ー'´    ヽ           バ
    | |            ＼        バ   ン
    ヽ  -''\"~｀\`'ー-､    -一'''''ー-､    ン
    ヽ ＿＿(⌒)(⌒)⌒) )    (⌒＿(⌒)⌒)⌒))"


    AA_NUM_MIN=1
    AA_NUM_MAX=3
    COUNT=20
    SUFFIX="AA2_"

    # if you want to disable Ctrl-C, comment-in
    #trap '' 1 2 3 4 5 15


    ####
    # メインの処理
    ####
    # 最初のAA(AA1)の出力
    echo -e "$AA1"
    sleep 1

    # COUNT分のループ処理(AA2_1〜AA2_3の出力)
    LINE=$(echo -e "${AA1}"|wc -l)
    NUM=${AA_NUM_MIN}
    until [ ${COUNT} -eq 0 ];
    do
        for i in $(seq 1 ${LINE});do
            echo $'\e[1A' $'\e[1G' $'\e[2K' $'\e[1A'
        done

        eval echo \"\${${SUFFIX}${NUM}}\"
        sleep 0.1

        LINE=$(eval echo -e \"\${${SUFFIX}${NUM}}\"|wc -l)
        NUM=$((${NUM} + 1))
        if [ ${NUM} -gt ${AA_NUM_MAX} ];then
            NUM=${AA_NUM_MIN}
        fi

        COUNT=$((COUNT - 1))
    done

    return 1
}


awssts() {
    if [[ "$1" == "" ]] ; then
        echo "トークンコードが無いです"
    else
        mfa=`aws iam list-mfa-devices --user-name kesoji | jq '.MFADevices[0].SerialNumber' -r`
        if [[ $? -ne 0 ]] ; then
            return
        fi

        data=`aws sts get-session-token --serial-number $mfa --token-code $1`
        if [[ $? -ne 0 ]] ; then
            return
        fi

        key=`echo $data | jq '.Credentials.AccessKeyId' -r`
        secret=`echo $data | jq '.Credentials.SecretAccessKey' -r`
        session=`echo $data | jq '.Credentials.SessionToken' -r`

        unset AWS_PROFILE
        export AWS_ACCESS_KEY_ID=$key
        export AWS_SECRET_ACCESS_KEY=$secret
        export AWS_SESSION_TOKEN=$session
        export AWS_DEFAULT_REGION=ap-northeast-1
        export AWS_STS_SESSION="IN-SESSION"
    fi
}

complete-ssh-host-fzf() {
    local host="$(egrep -i '^Host\s+.+' ~/.ssh/config $(find ~/.ssh/conf.d -type f 2>/dev/null) | egrep -v '[*?]' | awk '{print $2}' | sort | fzf)"

    [ ! -z "$host" ] && LBUFFER+="$host"
    zle reset-prompt
}
zle -N complete-ssh-host-fzf
bindkey '^s^s' complete-ssh-host-fzf

export PS1=`echo $PS1 | sed -e 's/|/(AWS:${AWS_PROFILE}${AWS_STS_SESSION})|/'`
AGNOSTER_PROMPT_SEGMENTS[2]=

# PROFILING. If you want to profile zsh initialization,
# Comment-in this code of the first line of
# ~/.zshenv
# `zmodload zsh/zprof && zprof`
if (which zprof > /dev/null) ;then
  zprof | less
fi

autoload -U +X bashcompinit && bashcompinit
complete -o nospace -C terraform terraform

export PATH="/opt/homebrew/opt/openjdk@11/bin:$PATH"

# tabtab source for packages
# uninstall by removing these lines
[[ -f ~/.config/tabtab/__tabtab.zsh ]] && . ~/.config/tabtab/__tabtab.zsh || true

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/home/kesoji/google-cloud-sdk/path.zsh.inc' ]; then . '/home/kesoji/google-cloud-sdk/path.zsh.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/home/kesoji/google-cloud-sdk/completion.zsh.inc' ]; then . '/home/kesoji/google-cloud-sdk/completion.zsh.inc'; fi

# Fig post block. Keep at the bottom of this file.
[[ -f "$HOME/.fig/shell/zshrc.post.zsh" ]] && builtin source "$HOME/.fig/shell/zshrc.post.zsh"
