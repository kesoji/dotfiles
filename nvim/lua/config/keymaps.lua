-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Swap gf and gF
-- gf: ファイル名:行番号:列番号 形式でジャンプ（元のgFの動作）
-- gF: ファイル名のみでジャンプ（元のgfの動作）
vim.keymap.set("n", "gf", "gF", { desc = "Go to file with line:column" })
vim.keymap.set("n", "gF", "gf", { desc = "Go to file" })
