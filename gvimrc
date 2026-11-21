" vim: fenc=utf-8
" GUI（MacVim・gVim）だけの設定。ふつうの設定は vimrc にある。

set guifont=Ricty_Diminished_Discord:h12,MS_Gothic:h12
set columns=240
set lines=60
set cmdheight=1
set guioptions-=T guioptions-=r guioptions-=R guioptions-=l guioptions-=L
set imdisable
set mouse=a
set mousehide
if has('win32')
  set renderoptions=type:directx
endif

set background=dark
try
  colorscheme gruvbox
catch
  try
    colorscheme retrobox
  catch
    colorscheme desert
  endtry
endtry
