#!/bin/sh

# Function to create symlink only if it doesn't exist or points to different target
safe_ln() {
    local source="$1"
    local target="$2"
    
    # If target doesn't exist or is not a symlink, create it
    if [ ! -L "$target" ]; then
        ln -sf "$source" "$target"
        return
    fi
    
    # If target exists and is a symlink, check if it points to the correct source
    local current_target=$(readlink "$target")
    if [ "$current_target" != "$source" ]; then
        ln -sf "$source" "$target"
    fi
}

# vim
mkdir -p ~/.vim
mkdir -p ~/.vim/backup
mkdir -p ~/.vim/swp
mkdir -p ~/.vim/undo
safe_ln ~/dotfiles/vimrc ~/.vimrc
safe_ln ~/dotfiles/gvimrc ~/.gvimrc
safe_ln ~/dotfiles/ideavimrc ~/.ideavimrc
safe_ln ~/dotfiles/vim/config ~/.vim/config
safe_ln ~/dotfiles/vim/rc ~/.vim/rc
safe_ln ~/dotfiles/vim/snippets ~/.vim/snippets
safe_ln ~/dotfiles/vim/after ~/.vim/after
safe_ln ~/dotfiles/vim/memo ~/.vim/memo
safe_ln ~/dotfiles/vim/template ~/.vim/template
# neovim
safe_ln ~/dotfiles/nvim ~/.config/nvim

# others
safe_ln ~/dotfiles/tmux.conf ~/.tmux.conf
safe_ln ~/dotfiles/gitconfig ~/.gitconfig
safe_ln ~/dotfiles/gitignore_global ~/.gitignore_global
safe_ln ~/dotfiles/zshrc ~/.zshrc
safe_ln ~/dotfiles/zshenv ~/.zshenv
safe_ln ~/dotfiles/sshrc ~/.sshrc
safe_ln ~/dotfiles/tigrc ~/.tigrc
safe_ln ~/dotfiles/inputrc ~/.inputrc
safe_ln ~/dotfiles/globalrc ~/.globalrc
safe_ln ~/dotfiles/irbrc ~/.irbrc
safe_ln ~/dotfiles/sshrc.d ~/.sshrc.d
safe_ln ~/dotfiles/npmrc ~/.npmrc

# .config
mkdir -p ~/.config
safe_ln ~/dotfiles/dotconfig/rsync ~/.config/rsync
safe_ln ~/dotfiles/dotconfig/wezterm ~/.config/wezterm
safe_ln ~/dotfiles/dotconfig/pnpm ~/.config/pnpm
mkdir -p ~/.config/alacritty
safe_ln ~/dotfiles/alacritty.yml ~/.config/alacritty/alacritty.yml
mkdir -p ~/.config/goneovim
safe_ln ~/dotfiles/goneovim_settings.toml ~/.config/goneovim/settings.toml
mkdir -p ~/.config/ghostty
safe_ln ~/dotfiles/ghostty ~/.config/ghostty/config
mkdir -p ~/.config/lazygit
safe_ln ~/dotfiles/lazygit/config.yml ~/.config/lazygit/config.yml

# claude
mkdir -p ~/.claude
safe_ln ~/dotfiles/claude/settings.json ~/.claude/settings.json
if [ -d ~/dotfiles/claude/commands ]; then
    mkdir -p ~/.claude/commands
    for cmd_file in ~/dotfiles/claude/commands/*; do
        if [ -f "$cmd_file" ]; then
            cmd_name=$(basename "$cmd_file")
            safe_ln "$cmd_file" ~/.claude/commands/"$cmd_name"
        fi
    done
fi

# vim-plug
if [ ! -s ~/.vim/autoload/plug.vim ]; then
  curl -fLo ~/.vim/autoload/plug.vim --create-dirs \
    https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
fi
