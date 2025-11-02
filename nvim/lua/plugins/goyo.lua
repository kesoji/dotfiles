return {
  "junegunn/goyo.vim",
  init = function()
    -- Goyoのサイズ設定（デフォルト: 80x85%）
    -- 幅x高さ% の形式で指定（%指定で画面サイズに対する割合）
    vim.g.goyo_width = "100%"  -- 横幅一杯
    vim.g.goyo_height = "100%"  -- 高さ一杯
  end,
  keys = {
    -- Goyo: 集中執筆モード（distraction-free writing）
    { "<C-w>o", "<cmd>Goyo<CR>", desc = "[C] Toggle Goyo (focus mode)" },
    { "<C-w><C-o>", "<cmd>Goyo<CR>", desc = "[C] Toggle Goyo (focus mode)" },
  },
}
