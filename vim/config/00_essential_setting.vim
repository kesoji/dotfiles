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

let mapleader = "\<Space>"
