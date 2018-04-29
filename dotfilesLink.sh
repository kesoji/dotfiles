#!/bin/sh
[ -d ~/.vim ] || mkdir ~/.vim
[ -d ~/.vim/backup ] || mkdir ~/.vim/backup
[ -d ~/.vim/swp ] || mkdir ~/.vim/swp
[ -d ~/.vim/undo ] || mkdir ~/.vim/undo
ln -sf ~/dotfiles/vimrc ~/.vimrc
ln -sf ~/dotfiles/gvimrc ~/.gvimrc
ln -sf ~/dotfiles/ideavimrc ~/.ideavimrc
ln -sf ~/dotfiles/tmux.conf ~/.tmux.conf
ln -sf ~/dotfiles/gitconfig ~/.gitconfig
ln -sf ~/dotfiles/gitignore_global ~/.gitignore_global
ln -sf ~/dotfiles/zshrc ~/.zshrc
ln -sf ~/dotfiles/zshenv ~/.zshenv
ln -sf ~/dotfiles/sshrc ~/.sshrc
ln -sf ~/dotfiles/tigrc ~/.tigrc
ln -sf ~/dotfiles/inputrc ~/.inputrc

# dir
ln -Tsf ~/dotfiles/sshrc.d ~/.sshrc.d
ln -Tsf ~/dotfiles/vim ~/.vim/config
ln -sf ~/dotfiles/rc ~/.vim/
ln -sf ~/dotfiles/snippets ~/.vim/
ln -sf ~/dotfiles/after ~/.vim/
ln -sf ~/dotfiles/memo ~/.vim/
ln -sf ~/dotfiles/template ~/.vim/

# zplezto
[ -d ~/.zprezto ] || git clone --recursive https://github.com/sorin-ionescu/prezto.git "${ZDOTDIR:-$HOME}/.zprezto"
#for rcfile in ${ZDOTDIR:-$HOME}/.zprezto/runcoms/z*; do
#    filename=`basename $rcfile`
#    ln -sf "$rcfile" "${ZDOTDIR:-$HOME}/.$filename"
#done
ln -sf ~/dotfiles/zpreztorc ~/.zpreztorc

# vim-plug
if [ ! -s ~/.vim/autoload/plug.vim ] ; then
    curl -fLo ~/.vim/autoload/plug.vim --create-dirs \
        https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
fi

