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
        require("mini.completion").setup() -- nvim-cmpにしたいかも？
        require("mini.cursorword").setup()
        require("mini.indentscope").setup()
        require("mini.notify").setup()
        require("mini.operators").setup({
          replace = {
            prefix = "gp", -- gr避け
          },
        })
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
        -- logger = {
        --   level = vim.log.levels.DEBUG,
        -- },
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
    {
      "nvim-treesitter/nvim-treesitter",
      build = ":TSUpdate",
      config = function()
        require("nvim-treesitter.configs").setup({
          highlight = {
            enable = true,
          },
          incremental_selection = {
            enable = true,
            keymaps = {
              init_selection = "vv",
              node_incremental = "v",
              scope_incremental = "V",
              node_decremental = "gv",
            },
          },
        })
      end,
    },
    {
      "gen740/SmoothCursor.nvim",
      config = function()
        require("smoothcursor").setup({ fancy = { enable = true } })
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
        { "<leader>cc", "<cmd>CopilotChatOpen<cr>", mode = { "n", "v" } },
        { "<leader>ce", "<cmd>CopilotChatExplain<cr>", mode = { "n", "v" } },
        { "<leader>co", "<cmd>CopilotChatOptimize<cr>", mode = { "n", "v" } },
        { "<leader>cr", "<cmd>CopilotChatReview<cr>", mode = { "n", "v" } },
        { "<leader>cf", "<cmd>CopilotChatFix<cr>", mode = { "n", "v" } },
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
        require("mason-lspconfig").setup_handlers({
          function(server_name)
            require("lspconfig")[server_name].setup({})
          end,
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
