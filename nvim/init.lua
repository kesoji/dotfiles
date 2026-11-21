-- Neovim の設定の入口。
-- プラグインは Neovim 標準の vim.pack で入れ、版は nvim-pack-lock.json で固定する。
-- 更新は :PackCooldown update だけ（初めて見てから30日たった版にだけ進む。lua/pack_cooldown.lua）。
require("config.options")
require("config.pack").setup()
require("config.plugins")
require("config.lsp")
require("config.autocmds")

-- Vim と共通のキーマップ（jj で抜ける・<C-n>/<C-p> でバッファ移動など）。下の keymaps.lua が後勝ち
local shared = vim.fn.expand("~/.vim/config/10_essential_mapping.vim")
if vim.fn.filereadable(shared) == 1 then
  vim.cmd.source(shared)
end
require("config.keymaps")

require("pack_cooldown").setup()
