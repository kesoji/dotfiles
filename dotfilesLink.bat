@echo off

IF NOT EXIST %USERPROFILE%"\.vim" (
    echo ".vim doesn't exist. creating .vim."
    mkdir %USERPROFILE%"\.vim"
) ELSE (
    echo ".vim exists."
)

mklink %USERPROFILE%"\.vimrc" %USERPROFILE%"\dotfiles\vimrc"
mklink %USERPROFILE%"\.gvimrc" %USERPROFILE%"\dotfiles\gvimrc"
mklink %USERPROFILE%"\.ideavimrc" %USERPROFILE%"\dotfiles\ideavimrc"
mklink %USERPROFILE%"\.vsvimrc" %USERPROFILE%"\dotfiles\vsvimrc"
mklink %USERPROFILE%"\.vim\mswin.vim" %USERPROFILE%"\dotfiles\mswin.vim"
mklink /D %USERPROFILE%"\.vim\rc" %USERPROFILE%"\dotfiles\rc"
mklink /D %USERPROFILE%"\.vim\snippets" %USERPROFILE%"\dotfiles\snippets"
mklink /D %USERPROFILE%"\.vim\after" %USERPROFILE%"\dotfiles\after"
mklink /D %USERPROFILE%"\.vim\memo" %USERPROFILE%"\dotfiles\memo"
mklink /D %USERPROFILE%"\.vim\template" %USERPROFILE%"\dotfiles\template"
mklink /D %USERPROFILE%"\.vim\config" %USERPROFILE%"\dotfiles\vim"
mklink /D %USERPROFILE%"\vimfiles" %USERPROFILE%"\.vim"

mklink %USERPROFILE%"\.gitconfig" %USERPROFILE%"\dotfiles\gitconfig"
mklink %USERPROFILE%"\.gitignore_global" %USERPROFILE%"\dotfiles\gitignore_global"

