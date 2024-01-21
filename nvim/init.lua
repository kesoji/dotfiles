local opt = vim.opt

if vim.g.vscode then
    -- VSCode extension
else
    -- ordinary Neovim

    -- Package Manager - lazy.nvim
    local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
    if not vim.loop.fs_stat(lazypath) then
      vim.fn.system({
        "git",
        "clone",
        "--filter=blob:none",
        "https://github.com/folke/lazy.nvim.git",
        "--branch=stable", -- latest stable release
        lazypath,
      })
    end
    opt.rtp:prepend(lazypath)
    require("lazy").setup(
      {
        { 'gen740/SmoothCursor.nvim', config = function() require('smoothcursor').setup(
          {
            fancy = { enable = true },
          }) end
        },
        { 'ggandor/leap.nvim', config = function() require('leap').create_default_mappings() end },
      }, 
      nil)
    -- 既存のVim Scriptを読み込む
    opt.rtp:append('~/.vim') -- prependの方がいいのだろうか
    opt.rtp:append('~/.vim/after')
    -- vim.cmd('source ~/.vimrc')
end

opt.filetype = "plugin", "indent", "on"
vim.cmd('source ~/.vim/config/00_essential_setting.vim')
vim.cmd('source ~/.vim/config/10_essential_mapping.vim')
