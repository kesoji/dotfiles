-- プラグインの更新に待ち期間（既定30日）を入れる（サプライチェーン攻撃対策）
--
-- コミットの日付は作者が自由に書けるので信用しない。代わりに、各プラグインのブランチの先頭を
-- `git ls-remote` で取り、「このマシンで初めて見た時刻」を台帳に書く。初めて見てから N 日たった
-- コミットにだけ lockfile（nvim-pack-lock.json）を進める。
--
--   記録: Neovim を開いたとき（裏で・前回から24時間たっているときだけ）と、:PackCooldown を流したとき
--   台帳: stdpath("state")/pack-cooldown.json（マシンごと・リポジトリには入れない）
--
-- コマンド:
--   :PackCooldown            記録して判定を表示する（何も変えない）
--   :PackCooldown update [N] 記録 → N 日（既定 vim.g.pack_cooldown_days or 30）たった版へ lockfile を進め、
--                            旧→新の差分を表示 → 再起動して vim.pack の確認画面（:w で確定・:q で取り消し）
--   :PackCooldown apply      lockfile の版へ実物を揃える（ほかのマシンで進めた lockfile を pull したとき・
--                            確認画面を取り消したあとにやり直すとき）
--   :PackCooldown clean      一覧（config.pack）から消したプラグインを lockfile とディスクから消す
local Pack = require("config.pack")

local M = {}

M.state_path = vim.fs.joinpath(vim.fn.stdpath("state"), "pack-cooldown.json")
M.probe_interval = 24 * 3600
M.forget_after = 400 * 86400 -- これより古い観測は台帳から落とす

local DAY = 86400

function M.days()
  return tonumber(vim.g.pack_cooldown_days) or 30
end

-- 台帳 ------------------------------------------------------------------------

---@class PackCooldownLedger
---@field last_probe? integer
---@field plugins table<string, {src: string, branch: string, seen: table<string, integer>}>

---@return PackCooldownLedger
local function read_ledger()
  local f = io.open(M.state_path, "r")
  if not f then
    return { plugins = {} }
  end
  local ok, data = pcall(vim.json.decode, f:read("*a"))
  f:close()
  if not ok or type(data) ~= "table" then
    return { plugins = {} }
  end
  data.plugins = type(data.plugins) == "table" and data.plugins or {}
  return data
end

--- ほかの Neovim が同時に書いた分も残すため、書く直前に読み直して混ぜる（同じ sha は早いほうの時刻）
---@param ledger PackCooldownLedger
local function write_ledger(ledger)
  local disk = read_ledger()
  local now = os.time()
  local names = {}
  for _, p in ipairs(Pack.plugins) do
    names[p.name] = p
  end
  local out = { last_probe = math.max(ledger.last_probe or 0, disk.last_probe or 0), plugins = {} }
  for name, p in pairs(names) do
    local seen = {}
    for _, from in ipairs({ disk, ledger }) do
      local src = from.plugins[name]
      -- 追いかけるブランチや取得元が変わったら、前の観測は捨てる
      if src and src.branch == p.branch and src.src == p.src then
        for sha, t in pairs(src.seen or {}) do
          if now - t < M.forget_after then
            seen[sha] = math.min(seen[sha] or t, t)
          end
        end
      end
    end
    if next(seen) then
      out.plugins[name] = { src = p.src, branch = p.branch, seen = seen }
    end
  end
  if not next(out.plugins) then
    out.plugins = vim.empty_dict()
  end
  vim.fn.mkdir(vim.fs.dirname(M.state_path), "p")
  local f = assert(io.open(M.state_path, "w"))
  f:write(vim.json.encode(out, { indent = "  ", sort_keys = true }), "\n")
  f:close()
end

--- 各プラグインのブランチの先頭を ls-remote で記録する（コードは落とさない）
---@param cb? fun(ledger: PackCooldownLedger, errors: string[])
function M.probe(cb)
  local ledger = read_ledger()
  local list = Pack.plugins
  local left, errors = #list, {}
  local now = os.time()
  local function done()
    ledger.last_probe = now
    write_ledger(ledger)
    if cb then
      cb(read_ledger(), errors)
    end
  end
  if left == 0 then
    return done()
  end
  for _, p in ipairs(list) do
    vim.system(
      { "git", "ls-remote", "--", p.src, "refs/heads/" .. p.branch },
      { text = true, timeout = 30000, env = { GIT_TERMINAL_PROMPT = "0" } },
      function(res)
        vim.schedule(function()
          local sha = res.code == 0 and (res.stdout or ""):match("^(%x+)%s") or nil
          if sha and #sha == 40 then
            local e = ledger.plugins[p.name]
            if not (e and e.branch == p.branch and e.src == p.src) then
              e = { src = p.src, branch = p.branch, seen = {} }
              ledger.plugins[p.name] = e
            end
            e.seen[sha] = e.seen[sha] or now
          else
            errors[#errors + 1] = p.name
          end
          left = left - 1
          if left == 0 then
            done()
          end
        end)
      end
    )
  end
end

-- 判定 ------------------------------------------------------------------------

local function plug_dir(name)
  return vim.fs.joinpath(vim.fn.stdpath("data"), "site", "pack", "core", "opt", name)
end

---@param dir string
---@param args string[]
---@return boolean ok, string out
local function git(dir, args)
  local res = vim.system(vim.list_extend({ "git", "-C", dir }, args), { text = true }):wait()
  return res.code == 0, vim.trim(res.stdout or "")
end

local function fmt_date(t)
  return os.date("%Y-%m-%d", t)
end

---@class PackCooldownItem
---@field name string
---@field cur? string 今の lockfile の版（無ければ新しく足すプラグイン）
---@field target? string 進める先
---@field target_seen? integer
---@field log? string[]
---@field count? integer
---@field note? string 進めない理由・待ちの残り

--- 台帳と lockfile から、プラグインごとに進める先を決める
---@param ledger PackCooldownLedger
---@param days number
---@param verify boolean 取得して「今の版の子孫か」を確かめる（update のとき）
---@return PackCooldownItem[]
function M.plan(ledger, days, verify)
  local lock = Pack.read_lock()
  local now, threshold = os.time(), days * DAY
  local items = {}

  -- 確かめるプラグインは先にまとめて取得しておく（並列）
  local fetches = {}
  if verify then
    for _, p in ipairs(Pack.plugins) do
      if vim.uv.fs_stat(plug_dir(p.name)) then
        fetches[p.name] = vim.system(
          { "git", "-C", plug_dir(p.name), "fetch", "--quiet", "origin" },
          { env = { GIT_TERMINAL_PROMPT = "0" } }
        )
      end
    end
  end

  for _, p in ipairs(Pack.plugins) do
    local item = { name = p.name, cur = (lock.plugins[p.name] or {}).rev } ---@type PackCooldownItem
    items[#items + 1] = item
    local seen = (ledger.plugins[p.name] or {}).seen or {}

    -- 待ち期間を過ぎた観測を、新しく見たものから順に並べる
    local ready, wait = {}, nil
    for sha, t in pairs(seen) do
      if sha ~= item.cur then
        if now - t >= threshold then
          ready[#ready + 1] = { sha = sha, t = t }
        else
          local left = threshold - (now - t)
          wait = wait and math.min(wait, left) or left
        end
      end
    end
    table.sort(ready, function(a, b)
      return a.t > b.t
    end)

    -- 今の版より後に初めて見たものだけが候補（今の版を初めて見た時刻より前の観測は古い版）
    local cur_seen = item.cur and seen[item.cur]
    if cur_seen then
      ready = vim.tbl_filter(function(r)
        return r.t > cur_seen
      end, ready)
    end

    if #ready == 0 then
      if next(seen) == nil then
        item.note = "まだ観測なし"
      elseif wait then
        item.note = ("待ち（あと %.1f 日）"):format(wait / DAY)
      else
        item.note = "変化なし"
      end
    elseif not verify then
      item.target, item.target_seen = ready[1].sha, ready[1].t
      if wait then
        item.note = ("さらに新しい版はあと %.1f 日"):format(wait / DAY)
      end
    else
      local dir = plug_dir(p.name)
      if fetches[p.name] then
        fetches[p.name]:wait()
      end
      for _, r in ipairs(ready) do
        if not item.cur then
          -- 新しく足すプラグイン: ディスクに無いので、確かめは導入時に vim.pack が行う
          item.target, item.target_seen = r.sha, r.t
          break
        end
        local has = git(dir, { "cat-file", "-e", r.sha .. "^{commit}" })
        local desc = has and git(dir, { "merge-base", "--is-ancestor", item.cur, r.sha })
        if desc then
          item.target, item.target_seen = r.sha, r.t
          local _, log = git(dir, { "log", "--oneline", "--no-decorate", "-n", "15", item.cur .. ".." .. r.sha })
          local _, count = git(dir, { "rev-list", "--count", item.cur .. ".." .. r.sha })
          item.log, item.count = vim.split(log, "\n", { trimempty = true }), tonumber(count)
          break
        end
      end
      if item.target and wait then
        item.note = ("さらに新しい版はあと %.1f 日"):format(wait / DAY)
      end
      if not item.target then
        item.note = "保留: 候補が今の版より古い・取得できない・今の版の子孫ではない（force-push の疑い）のどれか"
      end
    end
  end
  return items
end

-- 表示 ------------------------------------------------------------------------

local function short(sha)
  return sha and sha:sub(1, 7) or "(なし)"
end

---@param items PackCooldownItem[]
---@param days number
---@param errors string[]
---@param header string
local function show(items, days, errors, header)
  local lines = { header, ("待ち期間: %d 日（このマシンで初めて見た日から数える）"):format(days), "" }
  local moved, rest = {}, {}
  for _, it in ipairs(items) do
    if it.target then
      moved[#moved + 1] = it
    else
      rest[#rest + 1] = it
    end
  end
  lines[#lines + 1] = "## 進める"
  if #moved == 0 then
    lines[#lines + 1] = "  なし"
  end
  for _, it in ipairs(moved) do
    lines[#lines + 1] = ("  %-28s %s → %s  （初めて見た日 %s%s）"):format(
      it.name,
      short(it.cur),
      short(it.target),
      fmt_date(it.target_seen),
      it.count and (", %d コミット"):format(it.count) or ""
    )
    for _, l in ipairs(it.log or {}) do
      lines[#lines + 1] = "      " .. l
    end
    if it.count and it.log and it.count > #it.log then
      lines[#lines + 1] = ("      …ほか %d 件"):format(it.count - #it.log)
    end
    if it.note then
      lines[#lines + 1] = "      " .. it.note
    end
  end
  lines[#lines + 1] = ""
  lines[#lines + 1] = "## そのまま"
  for _, it in ipairs(rest) do
    lines[#lines + 1] = ("  %-28s %s  %s"):format(it.name, short(it.cur), it.note or "")
  end
  if #errors > 0 then
    lines[#lines + 1] = ""
    lines[#lines + 1] = "## 記録できなかった（ネットワーク？）: " .. table.concat(errors, ", ")
  end

  vim.cmd("tabnew")
  local buf = vim.api.nvim_get_current_buf()
  vim.bo[buf].buftype = "nofile"
  vim.bo[buf].bufhidden = "wipe"
  vim.bo[buf].swapfile = false
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = "markdown"
  vim.keymap.set("n", "q", "<cmd>tabclose<cr>", { buffer = buf, nowait = true })
  return lines
end

-- lockfile -------------------------------------------------------------------

--- vim.pack と同じ形（indent 2・キー順）で書く。version は vim.pack の書き方（'<sha>'）に合わせる
---@param items PackCooldownItem[]
local function write_lock(items)
  local lock = Pack.read_lock()
  local by_name = {}
  for _, p in ipairs(Pack.plugins) do
    by_name[p.name] = p
  end
  for _, it in ipairs(items) do
    if it.target then
      local l = lock.plugins[it.name] or { src = by_name[it.name].src }
      l.rev = it.target
      l.version = ("'%s'"):format(it.target)
      lock.plugins[it.name] = l
    end
  end
  local f = assert(io.open(Pack.lock_path, "w"))
  f:write(vim.json.encode(lock, { indent = "  ", sort_keys = true }), "\n")
  f:close()
end

-- コマンド ---------------------------------------------------------------------

function M.status(days)
  days = days or M.days()
  M.probe(function(ledger, errors)
    show(M.plan(ledger, days, false), days, errors, "# PackCooldown: 判定（何も変えていません）")
  end)
end

function M.update(days)
  days = days or M.days()
  vim.notify("PackCooldown: 記録して判定しています…")
  M.probe(function(ledger, errors)
    local items = M.plan(ledger, days, true)
    local any = vim.iter(items):any(function(it)
      return it.target ~= nil
    end)
    if not any then
      show(items, days, errors, "# PackCooldown: 進められる版はありません")
      return
    end
    write_lock(items)
    show(
      items,
      days,
      errors,
      "# PackCooldown: lockfile を進めました（取り消すなら git checkout -- nvim/nvim-pack-lock.json）"
    )
    vim.cmd("redraw")
    local choice = vim.fn.confirm("再起動して、実物を進める確認画面を開きますか？", "&Yes\n&No", 1)
    if choice == 1 then
      M.apply()
    else
      vim.notify("あとで :PackCooldown apply を流すと確認画面が開きます")
    end
  end)
end

--- lockfile の版へ実物を揃える（vim.pack の確認画面が出る）
function M.apply()
  local stat = vim.uv.fs_stat(Pack.lock_path)
  local changed = stat and stat.mtime.sec ~= Pack.lock_mtime_at_start
  local cmd = "lua vim.pack.update(nil, { target = 'lockfile' })"
  if changed then
    -- vim.pack は lockfile を起動時に1回だけ読むので、書き換えたあとは再起動が要る
    vim.cmd("restart " .. cmd)
  else
    vim.cmd(cmd)
  end
end

function M.clean()
  local keep = {}
  for _, p in ipairs(Pack.plugins) do
    keep[p.name] = true
  end
  local names = vim
    .iter(vim.pack.get(nil, { info = false }))
    :map(function(x)
      return x.spec.name
    end)
    :filter(function(n)
      return not keep[n]
    end)
    :totable()
  if #names == 0 then
    return vim.notify("消すプラグインはありません")
  end
  vim.pack.del(names)
end

--- 起動時: lockfile と実物のずれを知らせ、1日1回だけ裏で記録する
function M.on_startup()
  local lock = Pack.read_lock()
  local jobs = {}
  for _, p in ipairs(Pack.plugins) do
    local l = lock.plugins[p.name]
    local dir = plug_dir(p.name)
    if l and vim.uv.fs_stat(dir) then
      jobs[#jobs + 1] = { name = p.name, rev = l.rev, job = vim.system({ "git", "-C", dir, "rev-parse", "HEAD" }, { text = true }) }
    end
  end
  vim.defer_fn(function()
    local diff = {}
    for _, j in ipairs(jobs) do
      local res = j.job:wait(5000)
      local head = vim.trim(res.stdout or "")
      if res.code == 0 and head ~= j.rev then
        diff[#diff + 1] = ("  %s: 実物 %s / lockfile %s"):format(j.name, short(head), short(j.rev))
      end
    end
    if #diff > 0 then
      vim.notify(
        "lockfile と実物の版がずれています。:PackCooldown apply で lockfile の版に揃えます\n" .. table.concat(diff, "\n"),
        vim.log.levels.WARN
      )
    end
  end, 200)

  local ledger = read_ledger()
  if os.time() - (ledger.last_probe or 0) >= M.probe_interval then
    M.probe()
  end
end

function M.setup()
  vim.api.nvim_create_user_command("PackCooldown", function(args)
    local sub, n = args.fargs[1], tonumber(args.fargs[2])
    if sub == nil then
      M.status()
    elseif tonumber(sub) then
      M.status(tonumber(sub))
    elseif sub == "update" then
      M.update(n)
    elseif sub == "apply" then
      M.apply()
    elseif sub == "clean" then
      M.clean()
    else
      vim.notify("使い方: :PackCooldown [日数] | update [日数] | apply | clean", vim.log.levels.ERROR)
    end
  end, {
    nargs = "*",
    complete = function()
      return { "update", "apply", "clean" }
    end,
    desc = "プラグインの更新（初めて見てから N 日たった版だけ）",
  })

  vim.api.nvim_create_autocmd("VimEnter", {
    once = true,
    callback = function()
      vim.defer_fn(M.on_startup, 1000)
    end,
  })
end

return M
