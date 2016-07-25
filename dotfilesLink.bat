@echo off

IF NOT EXIST %USERPROFILE%"\.vim" (
    echo ".vim doesn't exist. creating .vim."
    mkdir %USERPROFILE%"\.vim"
) ELSE (
    echo ".vim exists."
)

mklink %USERPROFILE%"\.vimrc" %USERPROFILE%"\dotfiles\.vimrc"
mklink %USERPROFILE%"\.gvimrc" %USERPROFILE%"\dotfiles\.gvimrc"
mklink %USERPROFILE%"\.vim\mswin.vim" %USERPROFILE%"\dotfiles\mswin.vim"
mklink /D %USERPROFILE%"\.vim\rc" %USERPROFILE%"\dotfiles\rc"
mklink /D %USERPROFILE%"\.vim\snippets" %USERPROFILE%"\dotfiles\snippets"
mklink /D %USERPROFILE%"\.vim\after" %USERPROFILE%"\dotfiles\after"
mklink /D %USERPROFILE%"\vimfiles" %USERPROFILE%"\.vim"
