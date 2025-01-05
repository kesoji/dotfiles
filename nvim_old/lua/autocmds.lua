local augroup = vim.api.nvim_create_augroup
local autocmd = vim.api.nvim_create_autocmd

-- Trailing Whitespaceを削除
autocmd({ "BufWritePre" }, {
  pattern = "*",
  command = ":%s/\\s\\+$//e",
})

-- formatoptionsを設定。 :h fo-c :h fo-r :h fo-o
-- cでコメントをtextwidthでWrapする
-- r(Enter)とoでコメントを自動挿入する。
-- を -=で削除している
autocmd({ "BufEnter" }, {
  pattern = "*",
  command = "set fo-=c fo-=r fo-=o",
})

-- Restore cursor location when file is opened
autocmd({ "BufReadPost" }, {
  pattern = { "*" },
  callback = function()
    vim.api.nvim_exec('silent! normal! g`"zv', false)
  end,
})

-- 再起動コマンド
local restart_cmd = nil

if vim.g.neovide then
  if vim.fn.has("wsl") == 1 then
    restart_cmd = "silent! !nohup neovide.exe --wsl &"
  else
    restart_cmd = "silent! !neovide.exe"
  end
elseif vim.g.fvim_loaded then
  if vim.fn.has("wsl") == 1 then
    restart_cmd = "silent! !nohup fvim.exe &"
  else
    restart_cmd = [=[silent! !powershell -Command "Start-Process -FilePath fvim.exe"]=]
  end
end

vim.api.nvim_create_user_command("Restart", function()
  if vim.fn.has("gui_running") then
    if restart_cmd == nil then
      vim.notify("Restart command not found", vim.log.levels.WARN)
    end
  end

  require("possession.session").save("restart", { no_confirm = true })
  vim.cmd([[silent! bufdo bwipeout]])

  vim.g.NVIM_RESTARTING = true

  if restart_cmd then
    vim.cmd(restart_cmd)
  end

  vim.cmd([[qa!]])
end, {})

vim.api.nvim_create_autocmd("VimEnter", {
  nested = true,
  callback = function()
    if vim.g.NVIM_RESTARTING then
      vim.g.NVIM_RESTARTING = false
      require("possession.session").load("restart")
      require("possession.session").delete("restart", { no_confirm = true })
      vim.opt.cmdheight = 1
    end
  end,
})
