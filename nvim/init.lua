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

  require("lazy").setup({
    -- Configure any other settings here. See the documentation for more details.
    -- colorscheme that will be used when installing plugins.
    install = { colorscheme = { "ayu-mirage" } },
    -- automatically check for plugin updates
    checker = { enabled = true },
    spec = {
      {
        "Shatur/neovim-ayu",
        lazy = false,
        priority = 1000,
      },
      {
        "folke/tokyonight.nvim",
        lazy = false, -- make sure we load this during startup if it is your main colorscheme
        priority = 1000, -- make sure to load this before all the other start plugins
      },
      -- 詰め合わせ。
      {
        "echasnovski/mini.nvim",
        version = "*",
        config = function()
          require("mini.ai").setup()
          require("mini.animate").setup()
          require("mini.bracketed").setup()
          require("mini.notify").setup()
          require("mini.operators").setup()
          require("mini.pairs").setup()
          require("mini.starter").setup()
          require("mini.statusline").setup()
        end,
      },
      {
        "ggandor/leap.nvim",
        lazy = false, -- Lazyが先に起動したときにSがぶつかるので..
        priority = 900,
        config = function()
          require("leap").create_default_mappings()
        end,
      },
      {
        "j-hui/fidget.nvim",
        version = "*",
        opts = {
          -- options
          logger = {
            level = vim.log.levels.DEBUG,
          },
        },
      },
      { "nvim-lua/plenary.nvim" },
      {
        "jedrzejboczar/possession.nvim",
        dependencies = { "nvim-lua/plenary.nvim" },
      },
      {
        "nvim-telescope/telescope.nvim",
        branch = "0.1.x",
        dependencies = { "nvim-lua/plenary.nvim" },
        keys = {
          { "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Find files" },
          { "<leader>fg", "<cmd>Telescope live_grep<cr>", desc = "Live grep" },
          { "<leader>fb", "<cmd>Telescope buffers<cr>", desc = "Find buffers" },
          { "<leader>fh", "<cmd>Telescope help_tags<cr>", desc = "Find helps" },
          { "<leader>fm", "<cmd>Telescope oldfiles<cr>", desc = "Find recent files" },
        },
      },
      { "nvim-treesitter/nvim-treesitter", build = ":TSUpdate" },
      {
        "gen740/SmoothCursor.nvim",
        config = function()
          require("smoothcursor").setup({
            fancy = { enable = true },
          })
        end,
      },
      {
        "akinsho/toggleterm.nvim",
        version = "*",
        config = function()
          require("toggleterm").setup({
            size = 20,
            open_mapping = [[<C-t>]],
            hide_numbers = true,
            shade_filetypes = {},
            shade_terminals = true,
            shading_factor = "1",
            start_in_insert = true,
            insert_mappings = true,
            persist_size = true,
            direction = "horizontal",
            close_on_exit = true,
            shell = vim.o.shell,
          })
        end,
      },
      {
        "kdheepak/lazygit.nvim",
        cmd = {
          "LazyGit",
          "LazyGitConfig",
          "LazyGitCurrentFile",
          "LazyGitFilter",
          "LazyGitFilterCurrentFile",
        },
        -- optional for floating window border decoration
        dependencies = { "nvim-lua/plenary.nvim" },
        -- setting the keybinding for LazyGit with 'keys' is recommended in
        -- order to load the plugin when the command is run for the first time
        keys = {
          { "<leader>g", "<cmd>LazyGit<cr>", desc = "LazyGit" },
        },
      },
      {
        "sindrets/diffview.nvim",
        config = true,
        keys = {
          { "<leader>df", "<cmd>DiffviewOpen<cr>", desc = "DiffViewOpen" },
        },
      },
      {
        "lewis6991/gitsigns.nvim",
        config = true,
      },
      {
        "kylechui/nvim-surround",
        version = "*", -- Use for stability; omit to use `main` branch for the latest features
        event = "VeryLazy",
        config = function()
          require("nvim-surround").setup({
            -- Configuration here, or leave empty to use defaults
          })
        end,
      },
      {
        "nvim-neo-tree/neo-tree.nvim",
        branch = "v3.x",
        dependencies = {
          "nvim-lua/plenary.nvim",
          "nvim-tree/nvim-web-devicons", -- not strictly required, but recommended
          "MunifTanjim/nui.nvim",
          -- "3rd/image.nvim", -- Optional image support in preview window: See `# Preview Mode` for more information
        },
        keys = {
          { "<C-e>", "<cmd>Neotree toggle filesystem reveal left<cr>", desc = "NeoTree" },
        },
      },
      { "github/copilot.vim" },
      {
        "CopilotC-Nvim/CopilotChat.nvim",
        dependencies = {
          { "github/copilot.vim" }, -- or zbirenbaum/copilot.lua
          { "nvim-lua/plenary.nvim", branch = "master" }, -- for curl, log and async functions
        },
        build = "make tiktoken", -- Only on MacOS or Linux
        opts = {
          -- See Configuration section for options
        },
        keys = {
          { "<leader>cc", "<cmd>CopilotChatOpen<cr>" },
          { "<leader>ce", "<cmd>CopilotChatExplain<cr>" },
          { "<leader>co", "<cmd>CopilotChatOptimize<cr>" },
          { "<leader>cr", "<cmd>CopilotChatReview<cr>" },
          { "<leader>cf", "<cmd>CopilotChatFix<cr>" },
        },
        -- See Commands section for default commands if you want to lazy load on them
      },
      {
        "akinsho/bufferline.nvim",
        version = "*",
        dependencies = "nvim-tree/nvim-web-devicons",
        config = function()
          require("bufferline").setup({})
        end,
      },
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
        config = function()
          require("barbecue").setup({ theme = "ayu-mirage" })
        end,
      },
      -- LSP
      {
        "williamboman/mason.nvim",
        build = ":MasonUpdate",
        opts = {},
      },

      {
        "neovim/nvim-lspconfig",
        dependencies = {
          "williamboman/mason.nvim",
          "williamboman/mason-lspconfig.nvim",
        },
        config = function()
          require("mason-lspconfig").setup({
            ensure_installed = {
              "lua_ls",
              "gopls",
            },
          })

          -- 意味無い気がする
          require("lspconfig").lua_ls.setup({
            settings = {
              Lua = {
                format = {
                  enable = false,
                },
              },
            },
          })
        end,
      },
      {
        "nvimtools/none-ls.nvim",
        event = { "BufReadPre", "BufNewFile" },
        dependencies = {
          "jay-babu/mason-null-ls.nvim",
          "williamboman/mason.nvim",
        },
        config = function()
          local null_ls = require("null-ls")

          null_ls.setup({
            sources = {
              null_ls.builtins.formatting.stylua.with({
                extra_args = {
                  "--indent-type",
                  "Spaces",
                  "--indent-width",
                  "2",
                },
              }),
            },
          })

          -- mason-null-lsの設定
          require("mason-null-ls").setup({
            ensure_installed = {
              "goimports",
            },
            automatic_installation = true,
          })
        end,
      },
    },
  })
  require("mason-lspconfig").setup_handlers({
    function(server_name)
      require("lspconfig")[server_name].setup({})
    end,
  })
  -- 既存のVim Scriptを読み込む
  opt.rtp:append("~/.vim") -- prependの方がいいのだろうか
  opt.rtp:append("~/.vim/after")
  -- vim.cmd('source ~/.vimrc')
  require("colorscheme")

  local restart_cmd = nil

  -- 再起動コマンド
  if vim.g.neovide then
    if vim.fn.has("wsl") == 1 then
      restart_cmd = "silent! !nohup neovide.exe --wsl &"
    else
      restart_cmd = "silent! !neovide.exe"
    end
  elseif vim.g.fvim_loaded then
    if vim.fn.has("wsl") == 1 then
      restart_cmd = "silent! !nohup fvim.exe &"
    else
      restart_cmd = [=[silent! !powershell -Command "Start-Process -FilePath fvim.exe"]=]
    end
  end

  vim.api.nvim_create_user_command("Restart", function()
    if vim.fn.has("gui_running") then
      if restart_cmd == nil then
        vim.notify("Restart command not found", vim.log.levels.WARN)
      end
    end

    require("possession.session").save("restart", { no_confirm = true })
    vim.cmd([[silent! bufdo bwipeout]])

    vim.g.NVIM_RESTARTING = true

    if restart_cmd then
      vim.cmd(restart_cmd)
    end

    vim.cmd([[qa!]])
  end, {})

  vim.api.nvim_create_autocmd("VimEnter", {
    nested = true,
    callback = function()
      if vim.g.NVIM_RESTARTING then
        vim.g.NVIM_RESTARTING = false
        require("possession.session").load("restart")
        require("possession.session").delete("restart", { no_confirm = true })
        vim.opt.cmdheight = 1
      end
    end,
  })
end

vim.cmd("source ~/.vim/config/00_essential_setting.vim")
vim.cmd("source ~/.vim/config/10_essential_mapping.vim")

function _G.set_terminal_keymaps()
  -- 特にESCがLazyGitが使い辛くなるため下の設定でToggleTermオンリーに効く
  local opts = { buffer = 0 }
  vim.keymap.set("t", "<esc>", [[<C-\><C-n>]], opts)
  vim.keymap.set("t", "jk", [[<C-\><C-n>]], opts)
  -- vim.keymap.set('t', '<C-h>', [[<Cmd>wincmd h<CR>]], opts)
  -- vim.keymap.set('t', '<C-j>', [[<Cmd>wincmd j<CR>]], opts)
  -- vim.keymap.set('t', '<C-k>', [[<Cmd>wincmd k<CR>]], opts)
  -- vim.keymap.set('t', '<C-l>', [[<Cmd>wincmd l<CR>]], opts)
  vim.keymap.set("t", "<C-w>", [[<C-\><C-n><C-w>]], opts)
end

-- if you only want these mappings for toggle term use term://*toggleterm#* instead
vim.cmd("autocmd! TermOpen term://*toggleterm#* lua set_terminal_keymaps()")

-- vim.cmd('source ~/.config/nvim/temp.vim')

vim.keymap.set("n", "gd", "<cmd>:lua vim.lsp.buf.definition()<CR>")

vim.keymap.set("n", "<leader>ev", "<cmd>:e $MYVIMRC<CR>")

vim.keymap.set("n", "<leader>p", function()
  vim.lsp.buf.format({ async = true })
end)
