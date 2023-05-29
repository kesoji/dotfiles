#!/bin/sh

# vim
mkdir -p ~/.vim
mkdir -p ~/.vim/backup
mkdir -p ~/.vim/swp
mkdir -p ~/.vim/undo
ln -sf ~/dotfiles/vimrc ~/.vimrc
ln -sf ~/dotfiles/gvimrc ~/.gvimrc
ln -sf ~/dotfiles/ideavimrc ~/.ideavimrc
ln -sf ~/dotfiles/config ~/.vim/
ln -sf ~/dotfiles/rc ~/.vim/
ln -sf ~/dotfiles/snippets ~/.vim/
ln -sf ~/dotfiles/after ~/.vim/
ln -sf ~/dotfiles/memo ~/.vim/
ln -sf ~/dotfiles/template ~/.vim/

# others
ln -sf ~/dotfiles/tmux.conf ~/.tmux.conf
ln -sf ~/dotfiles/gitconfig ~/.gitconfig
ln -sf ~/dotfiles/gitignore_global ~/.gitignore_global
ln -sf ~/dotfiles/zshrc ~/.zshrc
ln -sf ~/dotfiles/zshenv ~/.zshenv
ln -sf ~/dotfiles/sshrc ~/.sshrc
ln -sf ~/dotfiles/tigrc ~/.tigrc
ln -sf ~/dotfiles/inputrc ~/.inputrc
ln -sf ~/dotfiles/globalrc ~/.globalrc
ln -sf ~/dotfiles/irbrc ~/.irbrc
ln -sf ~/dotfiles/sshrc.d ~/.sshrc.d

# .config
mkdir -p ~/.config
ln -sf ~/dotfiles/dotconfig/rsync ~/.config/
ln -sf ~/dotfiles/dotconfig/wezterm ~/.config/
mkdir -p ~/.config/alacritty
ln -sf ~/dotfiles/alacritty.yml ~/.config/alacritty/alacritty.yml

# vim-plug
if [ ! -s ~/.vim/autoload/plug.vim ] ; then
    curl -fLo ~/.vim/autoload/plug.vim --create-dirs \
        https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
fi
