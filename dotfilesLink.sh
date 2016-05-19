#!/bin/sh
[ -d ~/.vim ] || mkdir ~/.vim
[ -d ~/.vim/backup ] || mkdir ~/.vim/backup
[ -d ~/.vim/swp ] || mkdir ~/.vim/swp
[ -d ~/.vim/undo ] || mkdir ~/.vim/undo
ln -sf ~/dotfiles/.vimrc ~/.vimrc
ln -sf ~/dotfiles/.gvimrc ~/.gvimrc
ln -sf ~/dotfiles/rc ~/.vim
ln -sf ~/dotfiles/snippets ~/.vim
