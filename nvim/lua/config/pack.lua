-- プラグインの一覧と読み込み。マネージャは Neovim 標準の vim.pack。
--
-- 版は nvim-pack-lock.json（このディレクトリ・git 管理）の rev で固定する。
-- spec の version に lockfile のハッシュを入れるので、vim.pack.update() を誤って流しても
-- 進む先は今の版のまま。版を進めるのは :PackCooldown update だけ（lua/pack_cooldown.lua）。
--
-- プラグインを足すとき: 下の一覧に足すだけ。lockfile にまだ無いものは入れずに知らせ、
-- 台帳で「初めて見てから N 日」たったら :PackCooldown update で lockfile に載る。
-- プラグインを消すとき: 一覧から消し、:PackCooldown clean で lockfile とディスクから消す。
local M = {}

---@class PackPlugin
---@field name string
---@field src string
---@field branch string 追いかけるブランチ（待ち期間の台帳はこのブランチの先頭を記録する）

---@type PackPlugin[]
M.plugins = {
  { name = "fzf-lua", src = "https://github.com/ibhagwan/fzf-lua", branch = "main" },
  { name = "nvim-treesitter", src = "https://github.com/nvim-treesitter/nvim-treesitter", branch = "main" },
  {
    name = "nvim-treesitter-textobjects",
    src = "https://github.com/nvim-treesitter/nvim-treesitter-textobjects",
    branch = "main",
  },
  { name = "nvim-lspconfig", src = "https://github.com/neovim/nvim-lspconfig", branch = "master" },
  { name = "gitsigns.nvim", src = "https://github.com/lewis6991/gitsigns.nvim", branch = "main" },
  { name = "quicker.nvim", src = "https://github.com/stevearc/quicker.nvim", branch = "master" },
  { name = "conform.nvim", src = "https://github.com/stevearc/conform.nvim", branch = "master" },
  {
    name = "render-markdown.nvim",
    src = "https://github.com/MeanderingProgrammer/render-markdown.nvim",
    branch = "main",
  },
  { name = "SchemaStore.nvim", src = "https://github.com/b0o/SchemaStore.nvim", branch = "main" },
}

M.lock_path = vim.fs.joinpath(vim.fn.stdpath("config"), "nvim-pack-lock.json")

---@return {plugins: table<string, {rev: string, src: string, version?: string}>}
function M.read_lock()
  local f = io.open(M.lock_path, "r")
  if not f then
    return { plugins = {} }
  end
  local ok, data = pcall(vim.json.decode, f:read("*a"))
  f:close()
  if not ok or type(data) ~= "table" or type(data.plugins) ~= "table" then
    return { plugins = {} }
  end
  return data
end

--- 起動時に読んだ lockfile の更新時刻（:PackCooldown apply が再起動の要否を決めるのに使う）
M.lock_mtime_at_start = nil

--- このセッションで入れずに飛ばしたプラグイン（lockfile に無いもの）
M.skipped = {}

function M.setup()
  local stat = vim.uv.fs_stat(M.lock_path)
  M.lock_mtime_at_start = stat and stat.mtime.sec or nil

  local lock = M.read_lock()
  local specs = {}
  for _, p in ipairs(M.plugins) do
    local l = lock.plugins[p.name]
    if l and type(l.rev) == "string" then
      specs[#specs + 1] = { name = p.name, src = p.src, version = l.rev }
    else
      M.skipped[#M.skipped + 1] = p.name
    end
  end

  -- 版は lockfile のハッシュで固定しているので、初回の導入も確認なしでよい
  vim.pack.add(specs, { confirm = false })

  if #M.skipped > 0 then
    vim.schedule(function()
      vim.notify(
        ("lockfile に無いので入れていません: %s\n:PackCooldown で待ち期間の残りを確認できます"):format(
          table.concat(M.skipped, ", ")
        ),
        vim.log.levels.WARN
      )
    end)
  end
end

return M
