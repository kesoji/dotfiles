if [ ~/.zshrc -nt ~/.zshrc.zwc ]; then
    zcompile ~/.zshrc
fi

set -o vi

HISTFILE=~/.zsh_history
HISTSIZE=20000
SAVEHIST=20000
setopt share_history
setopt histignorealldups
# fzfがあれば上書きされると思う
bindkey '^r' history-incremental-pattern-search-backward
bindkey '^s' history-incremental-pattern-search-forward


if [[ -e ~/.zplug/init.zsh ]]; then
    source ~/.zplug/init.zsh
else
    cat << EOS
-----------------------------------------------------------------------------
    Hey! you don't have zplug.
      https://github.com/zplug/zplug
    \$ curl -sL --proto-redir -all,https https://raw.githubusercontent.com/zplug/installer/master/installer.zsh| zsh
-----------------------------------------------------------------------------
EOS
fi

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

export TERM=xterm-256color
export XDG_CONFIG_HOME=$HOME/.config
export GOPATH=$HOME/go
export PATH=$PATH:$GOPATH/bin
export PATH=$HOME/my/sbin:$HOME/my/bin:$PATH
export MANPATH=$HOME/my/share/man:$MANPATH
export LD_LIBRARY_PATH=$HOME/my/lib:$LD_LIBRARY_PATH
export LDFLAGS="-L$HOME/my/lib $LDFLAGS"
export CPPFLAGS="-I$HOME/my/include $CPPFLAGS"
export DISPLAY=:0.0
if [ "$(uname)" = 'Darwin' ] ; then
    export http_proxy=""
    export https_proxy=""
    export PATH=/usr/local/opt/openssl/bin:$PATH
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

# Plenv
if [ -e "${HOME}/.plenv" ]; then
  export PATH="$HOME/.plenv/bin:$PATH"
  #export PATH="$HOME/.plenv/bin:$HOME/.plenv/shims:$PATH"
  eval "$(plenv init -)"
fi

# Pyenv
if [ -e "${HOME}/.pyenv" ]; then
  export PYENV_ROOT="$HOME/.pyenv"
  export PATH="$PYENV_ROOT/bin:$PATH"
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
setopt hist_no_store

# Completion
compdef sshrc=ssh

# Alias
alias ls='ls -F --color'
alias ll='ls -l'
alias la='ls -la'
alias vi='vim'
alias c='clear'
alias tmux='tmux -2'
alias tma='tmux -2 a'
alias ssc='sshrc'
alias ap='ansible-playbook'
if [ "$(uname)" = 'Darwin' ] ; then
    alias ftpsv='launchctl load -w /System/Library/LaunchDaemons/ftp.plist'
    alias ftpsvstop='launchctl unload -w /System/Library/LaunchDaemons/ftp.plist'
    alias ls='ls -G'
fi

## Git
alias gst='git status'
alias ga='git add'
alias gp='git push'
alias gpl='git pull'

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


# SSHRC
which sshrc 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    cat << EOS
-----------------------------------------------------------------------------
    Hey! you don't have sshrc. You should download it from
      https://github.com/Russell91/sshrc"
    \$ wget https://raw.githubusercontent.com/Russell91/sshrc/master/sshrc
    \$ chmod +x sshrc
    \$ sudo mv sshrc /usr/local/bin #or anywhere else
-----------------------------------------------------------------------------
EOS
fi

# fzf
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh
which fzf 2>/dev/null 1>&2
if [[ $? -ne 0 ]] ; then
    cat << EOS
-----------------------------------------------------------------------------
    Hey! you don't have fzf. You should download it from
      https://github.com/junegunn/fzf
    \$ git clone https://github.com/junegunn/fzf.git ~/.fzf
    \$ ~/.fzf/install
-----------------------------------------------------------------------------
EOS
fi

# disable STOP (Ctrl+S)
[ -t 0 ] && stty stop undef

# NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm

# pet
if `which pet 2>/dev/null 1>&2` ; then
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

# The next line updates PATH for the Google Cloud SDK.
if [ -f $HOME/google-cloud-sdk/path.zsh.inc ]; then
  source "$HOME/google-cloud-sdk/path.zsh.inc"
fi

# The next line enables shell command completion for gcloud.
if [ -f $HOME/google-cloud-sdk/completion.zsh.inc ]; then
  source "$HOME/google-cloud-sdk/completion.zsh.inc"
fi
