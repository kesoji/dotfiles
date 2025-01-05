local opt = vim.opt

require("lua_helper")
require("autocmds")

if vim.g.vscode then
  -- VSCode extension
else
  -- ordinary Neovim

  -- Package Manager - lazy.nvim
  ---- Bootstrap lazy.nvim
  local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
  if not (vim.uv or vim.loop).fs_stat(lazypath) then
    local lazyrepo = "https://github.com/folke/lazy.nvim.git"
    local out = vim.fn.system({ "git", "clone", "--filter=blob:none", "--branch=stable", lazyrepo, lazypath })
    if vim.v.shell_error ~= 0 then
      vim.api.nvim_echo({
        { "Failed to clone lazy.nvim:\n", "ErrorMsg" },
        { out, "WarningMsg" },
        { "\nPress any key to exit..." },
      }, true, {})
      vim.fn.getchar()
      os.exit(1)
    end
  end
  opt.rtp:prepend(lazypath)

  ---- Make sure to setup `mapleader` and `maplocalleader` before
  ---- loading lazy.nvim so that mappings are correct.
  ---- This is also a good place to setup other settings (vim.opt)
  vim.g.mapleader = " "
  vim.g.maplocalleader = "\\"

  require("plugins")
  -- 既存のVim Scriptを読み込む
  opt.rtp:append("~/.vim") -- prependの方がいいのだろうか
  opt.rtp:append("~/.vim/after")
  -- vim.cmd('source ~/.vimrc')
  require("colorscheme")
end

vim.cmd("source ~/.vim/config/00_essential_setting.vim")
vim.cmd("source ~/.vim/config/10_essential_mapping.vim")
vim.keymap.set("n", "<leader>ev", "<cmd>:e $MYVIMRC<CR>")

-- vim.cmd('source ~/.config/nvim/temp.vim')

vim.keymap.set("n", "gd", vim.lsp.buf.definition)
vim.keymap.set("n", 'gi', vim.lsp.buf.implementation)
vim.keymap.set("n", 'gr', vim.lsp.buf.references)

vim.keymap.set("n", '<leader>e', vim.diagnostic.open_float)

-- なんで効かないの
vim.keymap.set("n", "<C-/>", "gcc", { noremap = false })

vim.keymap.set("n", "<leader>p", function()
  vim.lsp.buf.format({ async = true })
end)
