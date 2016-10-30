if [ ~/.zshrc -nt ~/.zshrc.zwc ]; then
    zcompile ~/.zshrc
fi

export XDG_CONFIG_HOME=$HOME/.config

# 補完機能を有効にする
autoload -Uz compinit && compinit -u
if [ -e /usr/local/share/zsh-completions ]; then
  fpath=(/usr/local/share/zsh-completions $fpath)
fi
# 補完で小文字でも大文字にマッチさせる
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'
# 補完候補を詰めて表示
setopt list_packed
# 補完候補一覧をカラー表示
zstyle ':completion:*' list-colors ''

# PROMPT
autoload -U promptinit
autoload -Uz colors && colors
PROMPT="%{${fg[green]}%}[%n@%m]%{${reset_color}%} %~
%# "

setopt correct
setopt no_beep

# alias
alias ls='ls -aF'
alias ll='ls -l'
alias la='ls -la'
alias cp='cp -i'
alias mv='mv -i'
alias vi='vim'
alias less='less -NM'
export CLICOLOR=1
export LSCOLORS=DxGxcxdxCxegedabagacad

# ディレクトリ移動関連
setopt auto_cd
setopt auto_pushd
DIRSTACKSIZE=100
# cdpathのディレクトリのディレクトリはどこからでもディレクトリ名打つだけで移動可能
cdpath=(.. ~)
# 補完候補一覧をカラー表示
## enable menu-style
zstyle ':completion:*' menu select
## exclude current dir
zstyle ':completion:*:cd:*' ignore-parents parent pwd
## message
zstyle ':completion:*:descriptions' format '%BCompleting%b %U%d%u'
