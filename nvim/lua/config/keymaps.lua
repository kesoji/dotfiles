-- キーマップ。LazyVim の既定（lazyvim/config/keymaps.lua と fzf の extra）と同じキーを、
-- 残したプラグインと標準の機能に割り当て直している。
-- LSP のキー（gd・gr・K・<leader>ca など）は config/lsp.lua、git の差分のキー（]h・<leader>gh…）は
-- config/plugins.lua の gitsigns にある。
local util = require("config.util")
local map = vim.keymap.set

-- 自分で足したキー -------------------------------------------------------------

-- gf と gF を入れ替える（gf: ファイル名:行:列 で飛ぶ / gF: ファイル名だけ）
map("n", "gf", "gF", { desc = "Go to file with line:column" })
map("n", "gF", "gf", { desc = "Go to file" })

-- Ctrl+/ と Cmd+/ でコメントの切り替え（標準の gc）
map("n", "<C-/>", "gcc", { remap = true, desc = "Comment line" })
map("x", "<C-/>", "gc", { remap = true, desc = "Comment selection" })
map("n", "<C-_>", "gcc", { remap = true, desc = "Comment line" })
map("x", "<C-_>", "gc", { remap = true, desc = "Comment selection" })
map("n", "<D-/>", "gcc", { remap = true, desc = "Comment line" })
map("x", "<D-/>", "gc", { remap = true, desc = "Comment selection" })

-- Ctrl+@ で浮動端末（toggleterm の代わり）
map({ "n", "i" }, "<C-@>", function()
  util.term_toggle("main")
end, { desc = "Toggle terminal" })

-- 補完: Tab で候補を確定（blink の super-tab と同じ）・スニペットの次の場所へ ------------
map({ "i", "s" }, "<Tab>", function()
  if vim.fn.pumvisible() == 1 then
    return vim.fn.complete_info({ "selected" }).selected == -1 and "<C-n><C-y>" or "<C-y>"
  elseif vim.snippet.active({ direction = 1 }) then
    return "<cmd>lua vim.snippet.jump(1)<cr>"
  end
  return "<Tab>"
end, { expr = true, desc = "Accept completion / next snippet field" })
map({ "i", "s" }, "<S-Tab>", function()
  if vim.fn.pumvisible() == 1 then
    return "<C-p>"
  elseif vim.snippet.active({ direction = -1 }) then
    return "<cmd>lua vim.snippet.jump(-1)<cr>"
  end
  return "<S-Tab>"
end, { expr = true, desc = "Prev completion / prev snippet field" })
map("i", "<C-Space>", "<C-x><C-o>", { desc = "Show completion" })

-- 移動・ウィンドウ ---------------------------------------------------------------
map({ "n", "x" }, "j", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true })
map({ "n", "x" }, "<Down>", "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true })
map({ "n", "x" }, "k", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true })
map({ "n", "x" }, "<Up>", "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true })

map("n", "<C-h>", "<C-w>h", { desc = "Go to Left Window", remap = true })
map("n", "<C-j>", "<C-w>j", { desc = "Go to Lower Window", remap = true })
map("n", "<C-k>", "<C-w>k", { desc = "Go to Upper Window", remap = true })
map("n", "<C-l>", "<C-w>l", { desc = "Go to Right Window", remap = true })

map("n", "<C-Up>", "<cmd>resize +2<cr>", { desc = "Increase Window Height" })
map("n", "<C-Down>", "<cmd>resize -2<cr>", { desc = "Decrease Window Height" })
map("n", "<C-Left>", "<cmd>vertical resize -2<cr>", { desc = "Decrease Window Width" })
map("n", "<C-Right>", "<cmd>vertical resize +2<cr>", { desc = "Increase Window Width" })

map("n", "<A-j>", "<cmd>execute 'move .+' . v:count1<cr>==", { desc = "Move Down" })
map("n", "<A-k>", "<cmd>execute 'move .-' . (v:count1 + 1)<cr>==", { desc = "Move Up" })
map("i", "<A-j>", "<esc><cmd>m .+1<cr>==gi", { desc = "Move Down" })
map("i", "<A-k>", "<esc><cmd>m .-2<cr>==gi", { desc = "Move Up" })
map("v", "<A-j>", ":<C-u>execute \"'<,'>move '>+\" . v:count1<cr>gv=gv", { desc = "Move Down" })
map("v", "<A-k>", ":<C-u>execute \"'<,'>move '<-\" . (v:count1 + 1)<cr>gv=gv", { desc = "Move Up" })

map("n", "<leader>-", "<C-W>s", { desc = "Split Window Below", remap = true })
map("n", "<leader>|", "<C-W>v", { desc = "Split Window Right", remap = true })
map("n", "<leader>wd", "<C-W>c", { desc = "Delete Window", remap = true })
map("n", "<leader>wm", util.zoom, { desc = "Toggle Zoom" })
map("n", "<leader>uZ", util.zoom, { desc = "Toggle Zoom" })

-- バッファ -------------------------------------------------------------------
map("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
map("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next Buffer" })
map("n", "[b", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
map("n", "]b", "<cmd>bnext<cr>", { desc = "Next Buffer" })
map("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
map("n", "<leader>`", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
map("n", "<leader>bd", function() util.bufdelete() end, { desc = "Delete Buffer" })
map("n", "<leader>bo", util.bufdelete_other, { desc = "Delete Other Buffers" })
map("n", "<leader>bD", "<cmd>:bd<cr>", { desc = "Delete Buffer and Window" })

-- 検索・編集 -------------------------------------------------------------------
map({ "i", "n", "s" }, "<esc>", function()
  vim.cmd("noh")
  if vim.snippet.active() then
    vim.snippet.stop()
  end
  return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })
map("n", "<leader>ur", "<Cmd>nohlsearch<Bar>diffupdate<Bar>normal! <C-L><CR>", { desc = "Redraw / Clear hlsearch" })

map("n", "n", "'Nn'[v:searchforward].'zv'", { expr = true, desc = "Next Search Result" })
map({ "x", "o" }, "n", "'Nn'[v:searchforward]", { expr = true, desc = "Next Search Result" })
map("n", "N", "'nN'[v:searchforward].'zv'", { expr = true, desc = "Prev Search Result" })
map({ "x", "o" }, "N", "'nN'[v:searchforward]", { expr = true, desc = "Prev Search Result" })

map("i", ",", ",<c-g>u")
map("i", ".", ".<c-g>u")
map("i", ";", ";<c-g>u")

map({ "i", "x", "n", "s" }, "<C-s>", "<cmd>w<cr><esc>", { desc = "Save File" })
map("n", "<leader>K", "<cmd>norm! K<cr>", { desc = "Keywordprg" })
map("x", "<", "<gv")
map("x", ">", ">gv")
map("n", "gco", "o<esc>Vcx<esc><cmd>normal gcc<cr>fxa<bs>", { desc = "Add Comment Below" })
map("n", "gcO", "O<esc>Vcx<esc><cmd>normal gcc<cr>fxa<bs>", { desc = "Add Comment Above" })
map("n", "<leader>fn", "<cmd>enew<cr>", { desc = "New File" })
map("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })

-- 整形 -----------------------------------------------------------------------
map({ "n", "x" }, "<leader>cf", function()
  require("conform").format()
end, { desc = "Format" })
map("n", "<leader>uf", function()
  vim.g.autoformat = not vim.g.autoformat
  vim.notify("保存時の整形（全体）: " .. (vim.g.autoformat and "on" or "off"))
end, { desc = "Toggle Auto Format (Global)" })
map("n", "<leader>uF", function()
  vim.b.autoformat = vim.b.autoformat == false
  vim.notify("保存時の整形（このバッファ）: " .. (vim.b.autoformat and "on" or "off"))
end, { desc = "Toggle Auto Format (Buffer)" })

-- 診断・quickfix ---------------------------------------------------------------
local function diagnostic_goto(next, severity)
  return function()
    vim.diagnostic.jump({
      count = (next and 1 or -1) * vim.v.count1,
      severity = severity and vim.diagnostic.severity[severity] or nil,
      float = true,
    })
  end
end
map("n", "<leader>cd", vim.diagnostic.open_float, { desc = "Line Diagnostics" })
map("n", "]d", diagnostic_goto(true), { desc = "Next Diagnostic" })
map("n", "[d", diagnostic_goto(false), { desc = "Prev Diagnostic" })
map("n", "]e", diagnostic_goto(true, "ERROR"), { desc = "Next Error" })
map("n", "[e", diagnostic_goto(false, "ERROR"), { desc = "Prev Error" })
map("n", "]w", diagnostic_goto(true, "WARN"), { desc = "Next Warning" })
map("n", "[w", diagnostic_goto(false, "WARN"), { desc = "Prev Warning" })

-- trouble の代わり: 診断を quickfix / location list に出す（quicker で読みやすくなる）
map("n", "<leader>xx", function() vim.diagnostic.setqflist() end, { desc = "Diagnostics (quickfix)" })
map("n", "<leader>xX", function() vim.diagnostic.setloclist() end, { desc = "Buffer Diagnostics (loclist)" })
map("n", "<leader>xl", function()
  local ok, err = pcall(vim.fn.getloclist(0, { winid = 0 }).winid ~= 0 and vim.cmd.lclose or vim.cmd.lopen)
  if not ok and err then
    vim.notify(err, vim.log.levels.ERROR)
  end
end, { desc = "Location List" })
map("n", "<leader>xq", function()
  local ok, err = pcall(vim.fn.getqflist({ winid = 0 }).winid ~= 0 and vim.cmd.cclose or vim.cmd.copen)
  if not ok and err then
    vim.notify(err, vim.log.levels.ERROR)
  end
end, { desc = "Quickfix List" })
map("n", "[q", vim.cmd.cprev, { desc = "Previous Quickfix" })
map("n", "]q", vim.cmd.cnext, { desc = "Next Quickfix" })

-- fzf-lua: 探す -----------------------------------------------------------------
local function fzf(cmd, opts)
  return function()
    local o = vim.deepcopy(opts or {})
    if o.cwd == "root" then
      o.cwd = util.root()
    end
    require("fzf-lua")[cmd](o)
  end
end
map("n", "<leader><space>", fzf("files", { cwd = "root" }), { desc = "Find Files (Root Dir)" })
map("n", "<leader>ff", fzf("files", { cwd = "root" }), { desc = "Find Files (Root Dir)" })
map("n", "<leader>fF", fzf("files"), { desc = "Find Files (cwd)" })
map("n", "<leader>fg", fzf("git_files"), { desc = "Find Files (git-files)" })
map("n", "<leader>fr", fzf("oldfiles"), { desc = "Recent" })
map("n", "<leader>fR", fzf("oldfiles", { cwd_only = true }), { desc = "Recent (cwd)" })
map("n", "<leader>fb", fzf("buffers", { sort_mru = true, sort_lastused = true }), { desc = "Buffers" })
map("n", "<leader>fB", fzf("buffers"), { desc = "Buffers (all)" })
map("n", "<leader>,", fzf("buffers", { sort_mru = true, sort_lastused = true }), { desc = "Switch Buffer" })
map("n", "<leader>fc", fzf("files", { cwd = vim.fn.stdpath("config") }), { desc = "Find Config File" })
map("n", "<leader>/", fzf("live_grep", { cwd = "root" }), { desc = "Grep (Root Dir)" })
map("n", "<leader>sg", fzf("live_grep", { cwd = "root" }), { desc = "Grep (Root Dir)" })
map("n", "<leader>sG", fzf("live_grep"), { desc = "Grep (cwd)" })
map("n", "<leader>sw", fzf("grep_cword", { cwd = "root" }), { desc = "Word (Root Dir)" })
map("n", "<leader>sW", fzf("grep_cword"), { desc = "Word (cwd)" })
map("x", "<leader>sw", fzf("grep_visual", { cwd = "root" }), { desc = "Selection (Root Dir)" })
map("x", "<leader>sW", fzf("grep_visual"), { desc = "Selection (cwd)" })
map("n", "<leader>:", fzf("command_history"), { desc = "Command History" })
map("n", "<leader>sc", fzf("command_history"), { desc = "Command History" })
map("n", "<leader>sC", fzf("commands"), { desc = "Commands" })
map("n", "<leader>s/", fzf("search_history"), { desc = "Search History" })
map("n", "<leader>sa", fzf("autocmds"), { desc = "Auto Commands" })
map("n", "<leader>sb", fzf("lines"), { desc = "Buffer Lines" })
map("n", "<leader>sd", fzf("diagnostics_workspace"), { desc = "Diagnostics" })
map("n", "<leader>sD", fzf("diagnostics_document"), { desc = "Buffer Diagnostics" })
map("n", "<leader>sh", fzf("help_tags"), { desc = "Help Pages" })
map("n", "<leader>sH", fzf("highlights"), { desc = "Search Highlight Groups" })
map("n", "<leader>sj", fzf("jumps"), { desc = "Jumplist" })
map("n", "<leader>sk", fzf("keymaps"), { desc = "Key Maps" })
map("n", "<leader>sl", fzf("loclist"), { desc = "Location List" })
map("n", "<leader>sM", fzf("manpages"), { desc = "Man Pages" })
map("n", "<leader>sm", fzf("marks"), { desc = "Jump to Mark" })
map("n", "<leader>sR", fzf("resume"), { desc = "Resume" })
map("n", "<leader>sq", fzf("quickfix"), { desc = "Quickfix List" })
map("n", "<leader>uC", fzf("colorschemes"), { desc = "Colorscheme with Preview" })
-- todo-comments の代わり: TODO などを grep する
map("n", "<leader>st", fzf("grep", { cwd = "root", search = [[\b(TODO|FIX|FIXME|HACK|WARN|PERF|NOTE)\b]], no_esc = true }), { desc = "Todo" })
map("n", "<leader>sT", fzf("grep", { cwd = "root", search = [[\b(TODO|FIX|FIXME)\b]], no_esc = true }), { desc = "Todo/Fix/Fixme" })

-- git --------------------------------------------------------------------------
map("n", "<leader>gc", fzf("git_commits"), { desc = "Commits" })
map("n", "<leader>gl", fzf("git_commits", { cwd = "root" }), { desc = "Git Log" })
map("n", "<leader>gL", fzf("git_commits"), { desc = "Git Log (cwd)" })
map("n", "<leader>gf", fzf("git_bcommits"), { desc = "Git Current File History" })
map("n", "<leader>gd", fzf("git_diff"), { desc = "Git Diff (files)" })
map("n", "<leader>gs", fzf("git_status"), { desc = "Status" })
map("n", "<leader>gS", fzf("git_stash"), { desc = "Git Stash" })
map("n", "<leader>gb", function() require("gitsigns").blame_line({ full = true }) end, { desc = "Git Blame Line" })
if vim.fn.executable("lazygit") == 1 then
  map("n", "<leader>gg", function()
    util.term_toggle("lazygit:" .. util.root(), { cmd = "lazygit", cwd = util.root() })
  end, { desc = "Lazygit (Root Dir)" })
  map("n", "<leader>gG", function()
    util.term_toggle("lazygit:" .. vim.uv.cwd(), { cmd = "lazygit" })
  end, { desc = "Lazygit (cwd)" })
end

-- ファイル一覧（neo-tree の代わりに標準の netrw を左に開く）-------------------------
map("n", "<leader>e", function() vim.cmd("Lexplore " .. vim.fn.fnameescape(util.root())) end, { desc = "Explorer (Root Dir)" })
map("n", "<leader>E", "<cmd>Lexplore<cr>", { desc = "Explorer (cwd)" })
map("n", "<leader>fe", function() vim.cmd("Lexplore " .. vim.fn.fnameescape(util.root())) end, { desc = "Explorer (Root Dir)" })
map("n", "<leader>fE", "<cmd>Lexplore<cr>", { desc = "Explorer (cwd)" })

-- 端末 -------------------------------------------------------------------------
map("n", "<leader>ft", function() util.term_toggle("root:" .. util.root(), { cwd = util.root() }) end, { desc = "Terminal (Root Dir)" })
map("n", "<leader>fT", function() util.term_toggle("cwd") end, { desc = "Terminal (cwd)" })

-- 切り替え -----------------------------------------------------------------------
map("n", "<leader>us", util.toggle_opt("spell"), { desc = "Toggle Spelling" })
map("n", "<leader>uw", util.toggle_opt("wrap"), { desc = "Toggle Wrap" })
map("n", "<leader>uL", util.toggle_opt("relativenumber"), { desc = "Toggle Relative Number" })
map("n", "<leader>ul", function()
  local on = not vim.wo.number
  vim.wo.number, vim.wo.relativenumber = on, on
end, { desc = "Toggle Line Numbers" })
map("n", "<leader>uc", util.toggle_opt("conceallevel", 2, 0), { desc = "Toggle Conceal Level" })
map("n", "<leader>uA", function() vim.o.showtabline = vim.o.showtabline == 0 and 2 or 0 end, { desc = "Toggle Tabline" })
map("n", "<leader>ub", function() vim.o.background = vim.o.background == "dark" and "light" or "dark" end, { desc = "Toggle Dark Background" })
map("n", "<leader>ud", function() vim.diagnostic.enable(not vim.diagnostic.is_enabled()) end, { desc = "Toggle Diagnostics" })
map("n", "<leader>uT", function()
  if vim.b.ts_highlight then
    vim.treesitter.stop()
  else
    vim.treesitter.start()
  end
end, { desc = "Toggle Treesitter Highlight" })
map("n", "<leader>um", function()
  require("render-markdown").toggle()
end, { desc = "Toggle Render Markdown" })
map("n", "<leader>ui", vim.show_pos, { desc = "Inspect Pos" })
map("n", "<leader>uI", function()
  vim.treesitter.inspect_tree()
  vim.api.nvim_input("I")
end, { desc = "Inspect Tree" })

-- タブ -------------------------------------------------------------------------
map("n", "<leader><tab>l", "<cmd>tablast<cr>", { desc = "Last Tab" })
map("n", "<leader><tab>o", "<cmd>tabonly<cr>", { desc = "Close Other Tabs" })
map("n", "<leader><tab>f", "<cmd>tabfirst<cr>", { desc = "First Tab" })
map("n", "<leader><tab><tab>", "<cmd>tabnew<cr>", { desc = "New Tab" })
map("n", "<leader><tab>]", "<cmd>tabnext<cr>", { desc = "Next Tab" })
map("n", "<leader><tab>d", "<cmd>tabclose<cr>", { desc = "Close Tab" })
map("n", "<leader><tab>[", "<cmd>tabprevious<cr>", { desc = "Previous Tab" })
