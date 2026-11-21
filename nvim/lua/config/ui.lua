-- 見た目のポップアップ: 右上に出て消える通知（nvim-notify）・画面の中ほどに出るコマンドライン（noice）・
-- キーの案内（which-key）。設定は LazyVim の既定に合わせている。
-- 通知は snacks の notifier ではなく nvim-notify を使う（snacks は通知のほかに大量の機能を抱えていて大きいため）。

-- nvim-notify: noice が通知をこれで表示する ------------------------------------
require("notify").setup({
  stages = "fade_in_slide_out",
  timeout = 3000,
  max_height = function()
    return math.floor(vim.o.lines * 0.75)
  end,
  max_width = function()
    return math.floor(vim.o.columns * 0.75)
  end,
  on_open = function(win)
    vim.api.nvim_win_set_config(win, { zindex = 100 })
  end,
})

-- noice: コマンドライン・メッセージ・LSP の進み具合の表示を置き換える ------------------
require("noice").setup({
  lsp = {
    override = {
      ["vim.lsp.util.convert_input_to_markdown_lines"] = true,
      ["vim.lsp.util.stylize_markdown"] = true,
    },
  },
  routes = {
    -- 保存したときの「"x" 10L, 200B written」や undo の「; after #3」は右下の小さい表示へ
    {
      filter = {
        event = "msg_show",
        any = { { find = "%d+L, %d+B" }, { find = "; after #%d+" }, { find = "; before #%d+" } },
      },
      view = "mini",
    },
  },
  presets = {
    bottom_search = true, -- / の検索は最下行のまま
    command_palette = true, -- : のコマンドラインと補完を画面の上の中ほどにまとめる
    long_message_to_split = true, -- 長いメッセージは分割ウィンドウへ
  },
})

-- which-key: <leader> などを押して止まると、続けて押せるキーを案内する --------------
local wk = require("which-key")
wk.setup({
  preset = "helix",
  icons = { mappings = false }, -- アイコンのプラグイン（mini.icons など）は入れていない
  spec = {
    {
      mode = { "n", "x" },
      { "<leader><tab>", group = "tabs" },
      { "<leader>c", group = "code" },
      { "<leader>f", group = "file/find" },
      { "<leader>g", group = "git" },
      { "<leader>gh", group = "hunks" },
      { "<leader>q", group = "quit" },
      { "<leader>s", group = "search" },
      { "<leader>sn", group = "noice" },
      { "<leader>u", group = "ui" },
      { "<leader>x", group = "diagnostics/quickfix" },
      { "[", group = "prev" },
      { "]", group = "next" },
      { "g", group = "goto" },
      { "z", group = "fold" },
      {
        "<leader>b",
        group = "buffer",
        expand = function()
          return require("which-key.extras").expand.buf()
        end,
      },
      {
        "<leader>w",
        group = "windows",
        proxy = "<c-w>",
        expand = function()
          return require("which-key.extras").expand.win()
        end,
      },
      { "gx", desc = "Open with system app" },
    },
  },
})

local map = vim.keymap.set
map("n", "<leader>?", function()
  wk.show({ global = false })
end, { desc = "Buffer Keymaps (which-key)" })
map("n", "<c-w><space>", function()
  wk.show({ keys = "<c-w>", loop = true })
end, { desc = "Window Hydra Mode (which-key)" })

-- 通知・メッセージ（LazyVim と同じキー）
local noice = require("noice")
map("c", "<S-Enter>", function()
  noice.redirect(vim.fn.getcmdline())
end, { desc = "Redirect Cmdline" })
map("n", "<leader>snl", function() noice.cmd("last") end, { desc = "Noice Last Message" })
map("n", "<leader>snh", function() noice.cmd("history") end, { desc = "Noice History" })
map("n", "<leader>sna", function() noice.cmd("all") end, { desc = "Noice All" })
map("n", "<leader>snd", function() noice.cmd("dismiss") end, { desc = "Dismiss All" })
map("n", "<leader>snt", function() noice.cmd("pick") end, { desc = "Noice Picker (FzfLua)" })
map("n", "<leader>n", function() noice.cmd("history") end, { desc = "Notification History" })
map("n", "<leader>un", function() noice.cmd("dismiss") end, { desc = "Dismiss All Notifications" })
-- ホバーなどの小窓をスクロールする（小窓が無いときは標準の <C-f> / <C-b>）
map({ "i", "n", "s" }, "<c-f>", function()
  if not require("noice.lsp").scroll(4) then
    return "<c-f>"
  end
end, { silent = true, expr = true, desc = "Scroll Forward" })
map({ "i", "n", "s" }, "<c-b>", function()
  if not require("noice.lsp").scroll(-4) then
    return "<c-b>"
  end
end, { silent = true, expr = true, desc = "Scroll Backward" })
