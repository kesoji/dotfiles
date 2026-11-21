-- キーマップから使う小さな関数（LazyVim / snacks / toggleterm の代わり）
local M = {}

--- プロジェクトの根: LSP の root_dir → .git のあるディレクトリ → cwd（LazyVim の root と同じ順）
---@param buf? integer
function M.root(buf)
  buf = buf or 0
  for _, client in ipairs(vim.lsp.get_clients({ bufnr = buf })) do
    if client.root_dir then
      return client.root_dir
    end
  end
  return vim.fs.root(buf, { ".git", "lua" }) or vim.uv.cwd()
end

-- 浮動ウィンドウの端末 -------------------------------------------------------

local terms = {} ---@type table<string, {buf: integer, win?: integer}>

local function float_win(buf)
  local width = math.floor(vim.o.columns * 0.9)
  local height = math.floor(vim.o.lines * 0.85)
  return vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    col = math.floor((vim.o.columns - width) / 2),
    row = math.floor((vim.o.lines - height) / 2) - 1,
    border = "rounded",
    style = "minimal",
  })
end

--- 浮動端末を開く・閉じる。同じ key の端末は使い回す（閉じても中身は残る）
---@param key string
---@param opts? {cmd?: string|string[], cwd?: string, close_on_exit?: boolean}
function M.term_toggle(key, opts)
  opts = opts or {}
  local t = terms[key]
  if t and t.win and vim.api.nvim_win_is_valid(t.win) then
    vim.api.nvim_win_hide(t.win)
    t.win = nil
    return
  end
  if not (t and vim.api.nvim_buf_is_valid(t.buf)) then
    local buf = vim.api.nvim_create_buf(false, true)
    t = { buf = buf }
    terms[key] = t
    t.win = float_win(buf)
    vim.fn.jobstart(opts.cmd or vim.o.shell, {
      term = true,
      cwd = opts.cwd,
      on_exit = function()
        vim.schedule(function()
          if t.win and vim.api.nvim_win_is_valid(t.win) then
            vim.api.nvim_win_close(t.win, true)
          end
          if vim.api.nvim_buf_is_valid(t.buf) then
            vim.api.nvim_buf_delete(t.buf, { force = true })
          end
          terms[key] = nil
        end)
      end,
    })
    vim.keymap.set("t", "<C-@>", function()
      M.term_toggle(key)
    end, { buffer = buf, desc = "Toggle terminal" })
  else
    t.win = float_win(t.buf)
  end
  vim.cmd.startinsert()
end

-- バッファ ----------------------------------------------------------------------

--- ウィンドウを残したままバッファを消す（Snacks.bufdelete の代わり）
---@param buf? integer
function M.bufdelete(buf)
  buf = (buf == nil or buf == 0) and vim.api.nvim_get_current_buf() or buf
  if vim.bo[buf].modified then
    local choice = vim.fn.confirm(("Save changes to %q?"):format(vim.fn.bufname(buf)), "&Yes\n&No\n&Cancel")
    if choice == 0 or choice == 3 then
      return
    elseif choice == 1 then
      vim.api.nvim_buf_call(buf, vim.cmd.write)
    end
  end
  for _, win in ipairs(vim.fn.win_findbuf(buf)) do
    vim.api.nvim_win_call(win, function()
      local alt = vim.fn.bufnr("#")
      if alt ~= buf and alt > 0 and vim.fn.buflisted(alt) == 1 then
        vim.api.nvim_win_set_buf(win, alt)
      else
        local ok = pcall(vim.cmd.bprevious)
        if not ok or vim.api.nvim_win_get_buf(win) == buf then
          vim.api.nvim_win_set_buf(win, vim.api.nvim_create_buf(true, false))
        end
      end
    end)
  end
  if vim.api.nvim_buf_is_valid(buf) then
    pcall(vim.cmd, "bdelete! " .. buf)
  end
end

--- 今のバッファ以外を消す
function M.bufdelete_other()
  local cur = vim.api.nvim_get_current_buf()
  for _, b in ipairs(vim.api.nvim_list_bufs()) do
    if b ~= cur and vim.bo[b].buflisted then
      M.bufdelete(b)
    end
  end
end

-- 切り替え ----------------------------------------------------------------------

--- オプションの切り替え（Snacks.toggle の代わり）
---@param name string
---@param on? any
---@param off? any
function M.toggle_opt(name, on, off)
  return function()
    if on == nil then
      vim.opt_local[name] = not vim.opt_local[name]:get()
    else
      vim.opt_local[name] = vim.opt_local[name]:get() == on and off or on
    end
    vim.notify(("%s = %s"):format(name, vim.inspect(vim.opt_local[name]:get())))
  end
end

--- ウィンドウを一時的に最大化する（もう一度押すと戻る）
function M.zoom()
  if vim.t.zoomed then
    vim.cmd("tabclose")
  else
    vim.cmd("tab split")
    vim.t.zoomed = true
  end
end

return M
