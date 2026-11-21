-- 各プラグインの設定。キーマップは config/keymaps.lua にまとめている（gitsigns のバッファごとのキーだけここ）。

-- fzf-lua: ファイル・grep・LSP の参照・git の検索 -------------------------------
local fzf = require("fzf-lua")
fzf.setup({
  "default-title",
  fzf_colors = true,
  defaults = { file_icons = false, git_icons = false },
  winopts = { width = 0.8, height = 0.8, row = 0.5, col = 0.5, preview = { scrollchars = { "┃", "│" } } },
  lsp = { symbols = { symbol_icons = false } },
})
fzf.register_ui_select() -- vim.ui.select（コードアクションの選択など）も fzf-lua で出す

-- nvim-treesitter（main ブランチ）: パーサを入れる。ハイライト自体は標準の vim.treesitter ------
local parsers = {
  "bash", "c", "css", "diff", "dockerfile", "go", "gomod", "gosum", "gowork", "hcl", "html",
  "javascript", "jsdoc", "json", "lua", "luadoc", "luap", "markdown", "markdown_inline", "php",
  "phpdoc", "printf", "python", "query", "regex", "rust", "terraform", "toml", "tsx", "typescript",
  "vim", "vimdoc", "vue", "xml", "yaml",
}
local TS = require("nvim-treesitter")
local installed = {}
for _, lang in ipairs(TS.get_installed()) do
  installed[lang] = true
end
local missing = vim.tbl_filter(function(lang)
  return not installed[lang]
end, parsers)
if #missing > 0 and vim.fn.executable("tree-sitter") == 1 then
  TS.install(missing, { summary = true })
end

vim.api.nvim_create_autocmd("FileType", {
  group = vim.api.nvim_create_augroup("my_treesitter", { clear = true }),
  callback = function(ev)
    if not pcall(vim.treesitter.start, ev.buf) then
      return
    end
    local lang = vim.treesitter.language.get_lang(vim.bo[ev.buf].filetype)
    if lang and vim.treesitter.query.get(lang, "indents") then
      vim.bo[ev.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
    end
    if lang and vim.treesitter.query.get(lang, "folds") then
      vim.wo[0][0].foldmethod = "expr"
      vim.wo[0][0].foldexpr = "v:lua.vim.treesitter.foldexpr()"
    end
  end,
})

-- nvim-treesitter-textobjects: 関数・クラス・引数の単位で移動・選択 ------------------
require("nvim-treesitter-textobjects").setup({
  select = { lookahead = true },
  move = { set_jumps = true },
})
local move = require("nvim-treesitter-textobjects.move")
local select = require("nvim-treesitter-textobjects.select")
local moves = {
  goto_next_start = { ["]f"] = "@function.outer", ["]c"] = "@class.outer", ["]a"] = "@parameter.inner" },
  goto_next_end = { ["]F"] = "@function.outer", ["]C"] = "@class.outer", ["]A"] = "@parameter.inner" },
  goto_previous_start = { ["[f"] = "@function.outer", ["[c"] = "@class.outer", ["[a"] = "@parameter.inner" },
  goto_previous_end = { ["[F"] = "@function.outer", ["[C"] = "@class.outer", ["[A"] = "@parameter.inner" },
}
for method, keys in pairs(moves) do
  for key, query in pairs(keys) do
    vim.keymap.set({ "n", "x", "o" }, key, function()
      -- diff 表示中の ]c [c は標準の「次の変更へ」を使う
      if vim.wo.diff and key:find("[cC]") then
        return vim.cmd("normal! " .. key)
      end
      move[method](query, "textobjects")
    end, { desc = query })
  end
end
for key, query in pairs({
  af = "@function.outer",
  ["if"] = "@function.inner",
  ac = "@class.outer",
  ic = "@class.inner",
  aa = "@parameter.outer",
  ia = "@parameter.inner",
}) do
  vim.keymap.set({ "x", "o" }, key, function()
    select.select_textobject(query, "textobjects")
  end, { desc = query })
end

-- gitsigns: 行の横に git の差分・blame ------------------------------------------
require("gitsigns").setup({
  signs = {
    add = { text = "▎" },
    change = { text = "▎" },
    delete = { text = "▁" },
    topdelete = { text = "▁" },
    changedelete = { text = "▎" },
    untracked = { text = "▎" },
  },
  signs_staged = {
    add = { text = "▎" },
    change = { text = "▎" },
    delete = { text = "▁" },
    topdelete = { text = "▁" },
    changedelete = { text = "▎" },
  },
  on_attach = function(buf)
    local gs = require("gitsigns")
    local function map(mode, l, r, desc)
      vim.keymap.set(mode, l, r, { buffer = buf, desc = desc, silent = true })
    end
    map("n", "]h", function()
      if vim.wo.diff then
        vim.cmd.normal({ "]c", bang = true })
      else
        gs.nav_hunk("next")
      end
    end, "Next Hunk")
    map("n", "[h", function()
      if vim.wo.diff then
        vim.cmd.normal({ "[c", bang = true })
      else
        gs.nav_hunk("prev")
      end
    end, "Prev Hunk")
    map("n", "]H", function() gs.nav_hunk("last") end, "Last Hunk")
    map("n", "[H", function() gs.nav_hunk("first") end, "First Hunk")
    map({ "n", "x" }, "<leader>ghs", ":Gitsigns stage_hunk<CR>", "Stage Hunk")
    map({ "n", "x" }, "<leader>ghr", ":Gitsigns reset_hunk<CR>", "Reset Hunk")
    map("n", "<leader>ghS", gs.stage_buffer, "Stage Buffer")
    map("n", "<leader>ghu", gs.undo_stage_hunk, "Undo Stage Hunk")
    map("n", "<leader>ghR", gs.reset_buffer, "Reset Buffer")
    map("n", "<leader>ghp", gs.preview_hunk_inline, "Preview Hunk Inline")
    map("n", "<leader>ghb", function() gs.blame_line({ full = true }) end, "Blame Line")
    map("n", "<leader>ghB", function() gs.blame() end, "Blame Buffer")
    map("n", "<leader>ghd", gs.diffthis, "Diff This")
    map("n", "<leader>ghD", function() gs.diffthis("~") end, "Diff This ~")
    map({ "o", "x" }, "ih", ":<C-U>Gitsigns select_hunk<CR>", "Select Hunk")
    map("n", "<leader>uG", function() gs.toggle_signs() end, "Toggle Git Signs")
  end,
})

-- quicker: quickfix を読みやすくし、その場で編集できるようにする ------------------
require("quicker").setup({})

-- conform: 整形（biome の設定があれば biome、prettier の設定だけあれば prettier）------
local function has_biome_config(ctx)
  return vim.fs.find({ "biome.json", "biome.jsonc" }, { path = ctx.filename, upward = true })[1]
end
local function has_prettier_config(ctx)
  return vim.fs.find({
    ".prettierrc", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.json5",
    ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.mjs",
    "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs",
  }, { path = ctx.filename, upward = true })[1]
end
local js_like = { "biome", "prettier", stop_after_first = true }
require("conform").setup({
  formatters = {
    biome = { condition = function(_, ctx) return has_biome_config(ctx) end },
    prettier = { condition = function(_, ctx) return has_prettier_config(ctx) and not has_biome_config(ctx) end },
  },
  formatters_by_ft = {
    typescript = js_like,
    javascript = js_like,
    typescriptreact = js_like,
    javascriptreact = js_like,
    json = js_like,
    jsonc = { "prettier" },
    vue = { "prettier" },
    css = { "prettier" },
    scss = { "prettier" },
    less = { "prettier" },
    html = { "prettier" },
    yaml = { "prettier" },
    markdown = { "prettier" },
    graphql = { "prettier" },
    lua = { "stylua" },
    sh = { "shfmt" },
    go = { "goimports", "gofumpt" },
    php = { "php_cs_fixer" },
    terraform = { "terraform_fmt" },
    hcl = { "terraform_fmt" },
  },
  default_format_opts = { timeout_ms = 3000, lsp_format = "fallback" },
  format_on_save = function(buf)
    if vim.g.autoformat == false or vim.b[buf].autoformat == false then
      return nil
    end
    return {}
  end,
})

-- render-markdown: Markdown を整えて表示 --------------------------------------
require("render-markdown").setup({
  code = { sign = false, width = "block", right_pad = 1 },
  heading = { sign = false, icons = {} },
  checkbox = { enabled = false },
})
