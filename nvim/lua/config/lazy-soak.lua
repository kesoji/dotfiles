-- プラグインの更新に「初観測から N 日」の cool time を入れる (supply chain 攻撃対策)
--
-- 乗っ取られたパッケージは大半が数時間〜数日で発覚・削除されるため、更新を数日寝かせる
-- だけで被害の多くを回避できる。pnpm の minimumReleaseAge / npm の min-release-age /
-- Dependabot の cooldown と同じ考え方。lazy.nvim には未実装 (folke/lazy.nvim#2141) なので自作。
--
-- git のコミット日時 (GIT_COMMITTER_DATE) は攻撃者が自由に設定できるので判断材料にしない。
-- 代わりに「自分が最初にそのコミットを観測した時刻」を台帳に記録し、N 日経過したものだけ採用する。
-- 副作用として tag の force-push や履歴の書き換えは「未観測のコミット」となり自動的に保留される。
local M = {}

M.days = 7
M.state_path = vim.fn.stdpath("state") .. "/lazy-soak.json"

---@return table<string, table<string, number>> plugin名 -> sha -> 初観測時刻(epoch)
local function read_ledger()
  local f = io.open(M.state_path, "r")
  if not f then
    return {}
  end
  local content = f:read("*a")
  f:close()
  local ok, data = pcall(vim.json.decode, content)
  return (ok and type(data) == "table") and data or {}
end

---@param ledger table<string, table<string, number>>
local function write_ledger(ledger)
  local f = assert(io.open(M.state_path, "w"))
  f:write(vim.json.encode(vim.tbl_isempty(ledger) and vim.empty_dict() or ledger))
  f:close()
end

---@param dir string
---@param args string[]
---@return string[]?
local function git(dir, args)
  local lines, code = require("lazy.manage.process").exec(vim.list_extend({ "git" }, args), { cwd = dir })
  return code == 0 and lines or nil
end

--- 台帳を更新し、採用してよい commit を決める (fetch 後に呼ぶこと)
---@param days number
---@return table<string, string> targets plugin名 -> checkout する sha
---@return table<string, string> held plugin名 -> 保留理由
function M.plan(days)
  local Config = require("lazy.core.config")
  local Git = require("lazy.manage.git")
  local now, threshold = os.time(), days * 86400
  local ledger, next_ledger = read_ledger(), {}
  local targets, held = {}, {}

  for name, plugin in pairs(Config.plugins) do
    -- pin / commit 指定 / ローカル開発中のものは元々追従しないので対象外
    if plugin._.installed and not plugin._.is_local and not plugin.pin and not plugin.commit then
      local ok, target = pcall(Git.get_target, plugin)
      local info = Git.info(plugin.dir)
      if ok and info and info.commit and target and target.commit and target.commit ~= info.commit then
        local seen = ledger[name] or {}
        if target.tag or target.version then
          -- tag / semver 追従: そのタグを初観測した時刻だけを見る (途中のコミットには進めない)
          local first_seen = seen[target.commit] or now
          next_ledger[name] = { [target.commit] = first_seen }
          if now - first_seen >= threshold then
            targets[name] = target.commit
          else
            held[name] = ("%s / 残り %.1f 日"):format(
              target.tag or target.commit:sub(1, 7),
              (threshold - (now - first_seen)) / 86400
            )
          end
        else
          -- ブランチ追従: 未適用のコミットを全部台帳に載せ、十分寝かせた最新のものを選ぶ
          local pending, pick = {}, nil
          for _, sha in ipairs(git(plugin.dir, { "rev-list", info.commit .. ".." .. target.commit }) or {}) do
            if #sha == 40 then -- rev-list は新しい順に返る
              pending[sha] = seen[sha] or now
              if not pick and now - pending[sha] >= threshold then
                pick = sha
              end
            end
          end
          next_ledger[name] = pending
          if pick then
            targets[name] = pick
          else
            -- 未観測のコミットが無い (= force-push でブランチが巻き戻された) 場合もここに来る
            local wait = threshold
            for _, first_seen in pairs(pending) do
              wait = math.min(wait, threshold - (now - first_seen))
            end
            held[name] = ("%d commits / 残り %.1f 日"):format(vim.tbl_count(pending), wait / 86400)
          end
        end
      end
    end
  end

  write_ledger(next_ledger) -- 対象外になったプラグイン・適用済みの sha は自動的に落ちる
  return targets, held
end

---@param held table<string, string>
---@return string[]
local function format_held(held)
  local lines = {}
  for name, why in pairs(held) do
    table.insert(lines, ("  %s: %s"):format(name, why))
  end
  table.sort(lines)
  return lines
end

--- fetch → 判定 → 寝かせ終わったコミットだけ更新
---@param days? number
function M.update(days)
  days = days or M.days
  local Config = require("lazy.core.config")

  require("lazy").check({ show = false }):wait(function()
    local targets, held = M.plan(days)

    if not vim.tbl_isempty(held) then
      vim.notify(("cool time 中 (%d日):\n%s"):format(days, table.concat(format_held(held), "\n")))
    end

    local names = vim.tbl_keys(targets)
    table.sort(names)
    if #names == 0 then
      return vim.notify(("%d日以上寝かせた更新はありません"):format(days))
    end

    for name, sha in pairs(targets) do
      Config.plugins[name].commit = sha -- このセッション限りの一時ピン
    end
    require("lazy").update({ plugins = names }):wait(function()
      for _, name in ipairs(names) do
        Config.plugins[name].commit = nil
      end
    end)
  end)
end

--- 更新はせず判定結果だけ表示する (台帳への観測記録は行う)
---@param days? number
function M.status(days)
  days = days or M.days
  require("lazy").check({ show = false }):wait(function()
    local targets, held = M.plan(days)
    local lines = { ("== 採用可 (初観測から%d日以上) =="):format(days) }
    local names = vim.tbl_keys(targets)
    table.sort(names)
    for _, name in ipairs(names) do
      table.insert(lines, ("  %s -> %s"):format(name, targets[name]:sub(1, 7)))
    end
    table.insert(lines, "== cool time 中 ==")
    vim.list_extend(lines, format_held(held))
    vim.notify(table.concat(lines, "\n"))
  end)
end

vim.api.nvim_create_user_command("LazySoak", function(args)
  M.update(tonumber(args.args))
end, { nargs = "?", desc = "初観測から N 日(既定7日)経過したコミットまでプラグインを更新" })

vim.api.nvim_create_user_command("LazySoakStatus", function(args)
  M.status(tonumber(args.args))
end, { nargs = "?", desc = "LazySoak の判定結果を表示 (更新はしない)" })

return M
