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

if which git-secrets >/dev/null ;  then
else
    cat << EOS
-----------------------------------------------------------------------------
    You should >>>
    git clone https://github.com/awslabs/git-secrets
    cd git-secrets
    sudo make install
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
export GOROOT=$HOME/go1.10
export PATH=$GOROOT/bin:$HOME/go/bin:$PATH
export PATH=$HOME/.local/bin:$HOME/my/sbin:$HOME/my/bin:$PATH
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
export LS_COLORS='no=00:fi=00:di=34:ow=34;40:ln=35:pi=30;44:so=35;44:do=35;44:bd=33;44:cd=37;44:or=05;37;41:mi=05;37;41:ex=01;31:*.cmd=01;31:*.exe=01;31:*.com=01;31:*.bat=01;31:*.reg=01;31:*.app=01;31:*.txt=32:*.org=32:*.md=32:*.mkd=32:*.h=32:*.hpp=32:*.c=32:*.C=32:*.cc=32:*.cpp=32:*.cxx=32:*.objc=32:*.cl=32:*.sh=32:*.bash=32:*.csh=32:*.zsh=32:*.el=32:*.vim=32:*.java=32:*.pl=32:*.pm=32:*.py=32:*.rb=32:*.hs=32:*.php=32:*.htm=32:*.html=32:*.shtml=32:*.erb=32:*.haml=32:*.xml=32:*.rdf=32:*.css=32:*.sass=32:*.scss=32:*.less=32:*.js=32:*.coffee=32:*.man=32:*.0=32:*.1=32:*.2=32:*.3=32:*.4=32:*.5=32:*.6=32:*.7=32:*.8=32:*.9=32:*.l=32:*.n=32:*.p=32:*.pod=32:*.tex=32:*.go=32:*.sql=32:*.csv=32:*.sv=32:*.svh=32:*.v=32:*.vh=32:*.vhd=32:*.bmp=33:*.cgm=33:*.dl=33:*.dvi=33:*.emf=33:*.eps=33:*.gif=33:*.jpeg=33:*.jpg=33:*.JPG=33:*.mng=33:*.pbm=33:*.pcx=33:*.pdf=33:*.pgm=33:*.png=33:*.PNG=33:*.ppm=33:*.pps=33:*.ppsx=33:*.ps=33:*.svg=33:*.svgz=33:*.tga=33:*.tif=33:*.tiff=33:*.xbm=33:*.xcf=33:*.xpm=33:*.xwd=33:*.xwd=33:*.yuv=33:*.aac=33:*.au=33:*.flac=33:*.m4a=33:*.mid=33:*.midi=33:*.mka=33:*.mp3=33:*.mpa=33:*.mpeg=33:*.mpg=33:*.ogg=33:*.opus=33:*.ra=33:*.wav=33:*.anx=33:*.asf=33:*.avi=33:*.axv=33:*.flc=33:*.fli=33:*.flv=33:*.gl=33:*.m2v=33:*.m4v=33:*.mkv=33:*.mov=33:*.MOV=33:*.mp4=33:*.mp4v=33:*.mpeg=33:*.mpg=33:*.nuv=33:*.ogm=33:*.ogv=33:*.ogx=33:*.qt=33:*.rm=33:*.rmvb=33:*.swf=33:*.vob=33:*.webm=33:*.wmv=33:*.doc=31:*.docx=31:*.rtf=31:*.odt=31:*.dot=31:*.dotx=31:*.ott=31:*.xls=31:*.xlsx=31:*.ods=31:*.ots=31:*.ppt=31:*.pptx=31:*.odp=31:*.otp=31:*.fla=31:*.psd=31:*.7z=1;35:*.apk=1;35:*.arj=1;35:*.bin=1;35:*.bz=1;35:*.bz2=1;35:*.cab=1;35:*.deb=1;35:*.dmg=1;35:*.gem=1;35:*.gz=1;35:*.iso=1;35:*.jar=1;35:*.msi=1;35:*.rar=1;35:*.rpm=1;35:*.tar=1;35:*.tbz=1;35:*.tbz2=1;35:*.tgz=1;35:*.tx=1;35:*.war=1;35:*.xpi=1;35:*.xz=1;35:*.z=1;35:*.Z=1;35:*.zip=1;35:*.ANSI-30-black=30:*.ANSI-01;30-brblack=01;30:*.ANSI-31-red=31:*.ANSI-01;31-brred=01;31:*.ANSI-32-green=32:*.ANSI-01;32-brgreen=01;32:*.ANSI-33-yellow=33:*.ANSI-01;33-bryellow=01;33:*.ANSI-34-blue=34:*.ANSI-01;34-brblue=01;34:*.ANSI-35-magenta=35:*.ANSI-01;35-brmagenta=01;35:*.ANSI-36-cyan=36:*.ANSI-01;36-brcyan=01;36:*.ANSI-37-white=37:*.ANSI-01;37-brwhite=01;37:*.log=01;32:*~=01;32:*#=01;32:*.bak=01;33:*.BAK=01;33:*.old=01;33:*.OLD=01;33:*.org_archive=01;33:*.off=01;33:*.OFF=01;33:*.dist=01;33:*.DIST=01;33:*.orig=01;33:*.ORIG=01;33:*.swp=01;33:*.swo=01;33:*,v=01;33:*.gpg=34:*.gpg=34:*.pgp=34:*.asc=34:*.3des=34:*.aes=34:*.enc=34:*.sqlite=34:';
# LESS
# [あなたの知らない less の世界 \- Qiita](http://qiita.com/delphinus/items/b04752bb5b64e6cc4ea9)
export LESS="-R -M -i -W -x4"
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

# AWS completion
if [ -f $HOME/.local/bin/aws_zsh_completer.sh ]; then
    source "$HOME/.local/bin/aws_zsh_completer.sh"
fi
