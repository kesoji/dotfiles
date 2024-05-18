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
