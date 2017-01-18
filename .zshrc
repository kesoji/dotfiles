if [ ~/.zshrc -nt ~/.zshrc.zwc ]; then
    zcompile ~/.zshrc
fi

set -o vi

# Source Prezto.
if [[ -s "${ZDOTDIR:-$HOME}/.zprezto/init.zsh" ]]; then
    source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"
else
    # PROMPT
    autoload -U promptinit
    autoload -Uz colors && colors
    PROMPT="%{${fg[green]}%}[%n@%m]%{${reset_color}%} %~
    $ "
    # ディレクトリ移動関連
    setopt auto_cd
    setopt auto_pushd
    DIRSTACKSIZE=100
    # cdpathのディレクトリのディレクトリはどこからでもディレクトリ名打つだけで移動可能
    cdpath=(.. ~)
    # 補完機能を有効にする
    autoload -Uz compinit && compinit -u
    # 補完で小文字でも大文字にマッチさせる
    zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'
    # 補完候補を詰めて表示
    setopt list_packed
    # 補完候補一覧をカラー表示
    zstyle ':completion:*' list-colors ''
    ## enable menu-style
    zstyle ':completion:*' menu select
    ## exclude current dir
    zstyle ':completion:*:cd:*' ignore-parents parent pwd
    ## message
    zstyle ':completion:*:descriptions' format '%BCompleting%b %U%d%u'
fi

# bash-completion someday...
#autoload -U +X bashcompinit && bashcompinit
#source /usr/share/bash-completion/completions/firewall-cmd

#export TERM=xterm-256color
export XDG_CONFIG_HOME=$HOME/.config
export PATH=$HOME/my/bin:$PATH
export MANPATH=$HOME/my/share/man:$MANPATH
export LD_LIBRARY_PATH=$HOME/my/lib:$LD_LIBRARY_PATH
if [ "$(uname)" = 'Darwin' ] ; then
    export http_proxy=""
    export https_proxy=""
fi
export CLICOLOR=1
export LSCOLORS=DxGxcxdxCxegedabagacad
# LESS
# [あなたの知らない less の世界 \- Qiita](http://qiita.com/delphinus/items/b04752bb5b64e6cc4ea9)
export LESS="-R -M -g -i -W -x4"
export LESSGLOBALTAGS=global
if which lesspipe.sh > /dev/null; then
    export LESSOPEN='| /usr/bin/env lesspipe.sh %s 2>&-'
fi

if [ -d ${HOME}/.pyenv ]; then
    export PYENV_ROOT="${HOME}/.pyenv"
    export PATH=${PYENV_ROOT}/bin:$PATH
    eval "$(pyenv init -)"
fi


if [ -e /usr/share/zsh/site-functions/ ]; then
    fpath=(/usr/share/zsh/sites-functions $fpath)
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


# GTAGS補完
# if [ `which global` ]; then
#     _global_complete() {
#         local cur
#         cur=${COMP_WORDS[COMP_CWORD]}
#         COMPREPLY=(`global -c $cur`)
#     }
#     complete -F _global_complete global
# fi

setopt correct
setopt no_beep

# Completion
compdef sshrc=ssh

# Alias
alias ls='ls -F --color'
alias ll='ls -l'
alias la='ls -la'
alias vi='vim'
alias tmux='tmux -2'

if [ "$(uname)" = 'Darwin' ] ; then
    alias ftpsv='launchctl load -w /System/Library/LaunchDaemons/ftp.plist'
    alias ftpsvstop='launchctl unload -w /System/Library/LaunchDaemons/ftp.plist'
    alias ls='ls -G'
fi

# SSHRC
which sshrc 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    echo "---------------------------------------------------------------------"
    echo "Hey! you don't have sshrc. You should download it from"
    echo "https://github.com/Russell91/sshrc"
    echo '$ wget https://raw.githubusercontent.com/Russell91/sshrc/master/sshrc'
    echo '$ chmod +x sshrc'
    echo '$ sudo move sshrc /usr/local/bin #or anywhere else'
    echo "---------------------------------------------------------------------"
fi

# disable STOP (Ctrl+S)
[ -t 0 ] && stty stop undef

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
