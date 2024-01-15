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
vim.opt.rtp:prepend(lazypath)
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
vim.opt.rtp:append('~/.vim') -- prependの方がいいのだろうか
vim.opt.rtp:append('~/.vim/after')
vim.cmd('source ~/.vimrc')
