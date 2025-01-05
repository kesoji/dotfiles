" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
" Essential Setting / Used for other text editor's plugin
""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
if has('vim_starting')
  set clipboard+=unnamed
  if !has('nvim')
    set clipboard+=autoselect
  endif
endif

set hidden
set number
set cursorline

set modeline

set expandtab         " default: off
set smarttab          " default: on
set textwidth=0       " default: 0 / 勝手に改行が入る位置
set virtualedit=block " default: "" / 文字がないところにもカーソルを移動できるようにする
set ignorecase        " default: off / 大文字小文字を区別しない
set smartcase         " default: off / 大文字が入っている時はCase Sensitiveにする
set infercase         " default: off / 補完時に大文字小文字を区別しない

let mapleader = "\<Space>"
