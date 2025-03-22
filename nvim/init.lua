-- bootstrap lazy.nvim, LazyVim and your plugins
require("config.lazy")

vim.cmd("source ~/.vim/config/10_essential_mapping.vim")

vim.keymap.set("i", "jk", "<ESC>", { noremap = true, silent = true })
vim.keymap.set("i", "jj", "<ESC>", { noremap = true, silent = true })
vim.keymap.set("i", "jl", "<ESC><RIGHT>", { noremap = true, silent = true })
