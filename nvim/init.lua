local opt = vim.opt

require('lua_helper')
require('autocmds')

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
        { 'folke/tokyonight.nvim', lazy = false, priority = 1000, opts = {} },
        {
          "utilyre/barbecue.nvim",
          name = "barbecue",
          version = "*",
          dependencies = {
            "SmiteshP/nvim-navic",
            "nvim-tree/nvim-web-devicons", -- optional dependency
          },
          opts = {
            -- configurations go here
          },
          -- 効いていないきがする
          config = function() require('barbecue').setup({ theme = 'tokyonight' }) end
        },
        {
          "williamboman/mason.nvim",
          build = ":MasonUpdate",
          opts = {},
        },
        {
          "williamboman/mason-lspconfig.nvim",
          dependencies = {
            { "williamboman/mason.nvim" },
            { "neovim/nvim-lspconfig" },
          },
          config = nil,
          opts = {
            ensure_installed = {
              "gopls",
              "lua-language-server",
            }
          },
        },
      },
      nil)
    -- 既存のVim Scriptを読み込む
    opt.rtp:append('~/.vim') -- prependの方がいいのだろうか
    opt.rtp:append('~/.vim/after')
    -- vim.cmd('source ~/.vimrc')

    vim.cmd[[colorscheme tokyonight]]
    -- vim.cmd[[colorscheme tokyonight-night]]
    -- vim.cmd[[colorscheme tokyonight-storm]]
    -- vim.cmd[[colorscheme tokyonight-day]]
    -- vim.cmd[[colorscheme tokyonight-moon]]
end

opt.filetype = "plugin", "indent", "on"
vim.cmd('source ~/.vim/config/00_essential_setting.vim')
vim.cmd('source ~/.vim/config/10_essential_mapping.vim')
