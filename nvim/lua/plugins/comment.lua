return {
  "nvim-mini/mini.comment",
  event = "VeryLazy",
  keys = {
    -- その他OS用（Ctrl+/）
    { "<C-/>", "gcc", mode = "n", remap = true, desc = "Comment line" },
    { "<C-/>", "gc", mode = "v", remap = true, desc = "Comment selection" },
    -- macOS用（Cmd+/）
    -- ターミナルエミュレータによっては届かないことも多いらしい...
    { "<D-/>", "gcc", mode = "n", remap = true, desc = "Comment line" },
    { "<D-/>", "gc", mode = "v", remap = true, desc = "Comment selection" },
  },
}
