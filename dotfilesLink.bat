@echo off

IF NOT EXIST %USERPROFILE%"\.vim" (
    echo ".vim doesn't exist. creating .vim."
    mkdir %USERPROFILE%"\.vim"
) ELSE (
    echo ".vim exists."
)

mklink %USERPROFILE%"\.vimrc" %USERPROFILE%"\dotfiles\.vimrc"
mklink %USERPROFILE%"\.gvimrc" %USERPROFILE%"\dotfiles\.gvimrc"
mklink %USERPROFILE%"\.ideavimrc" %USERPROFILE%"\dotfiles\.ideavimrc"
mklink %USERPROFILE%"\.tmux.conf" %USERPROFILE%"\dotfiles\.tmux.conf"
mklink %USERPROFILE%"\.gitconfig" %USERPROFILE%"\dotfiles\.gitconfig"
mklink %USERPROFILE%"\.gitignore_global" %USERPROFILE%"\dotfiles\.gitignore_global"
mklink %USERPROFILE%"\.vim\mswin.vim" %USERPROFILE%"\dotfiles\mswin.vim"
mklink %USERPROFILE%"\.zshrc" %USERPROFILE%"\dotfiles\.zshrc"
mklink %USERPROFILE%"\.sshrc" %USERPROFILE%"\dotfiles\.sshrc"
mklink %USERPROFILE%"\.tigrc" %USERPROFILE%"\dotfiles\.tigrc"
mklink %USERPROFILE%"\.minttyrc" %USERPROFILE%"\dotfiles\.minttyrc"
mklink /D %USERPROFILE%"\.vim\rc" %USERPROFILE%"\dotfiles\rc"
mklink /D %USERPROFILE%"\.vim\snippets" %USERPROFILE%"\dotfiles\snippets"
mklink /D %USERPROFILE%"\.vim\after" %USERPROFILE%"\dotfiles\after"
mklink /D %USERPROFILE%"\vimfiles" %USERPROFILE%"\.vim"
