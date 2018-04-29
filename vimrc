" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

nnoremap <Leader>j :!rm -f ~/winhome/Desktop/pittouch.zip &&  zip -r ~/winhome/Desktop/pittouch.zip pittouch/* -x G*<CR>

set runtimepath+=~/.vim/
runtime! config/*.vim


function! TeachKey(message)
    let summon = join(["!clear; cowsay -f dragon ", a:message, "を押すのだ"])
    exec summon
endfun

noremap  <buffer> <Left>     <Esc>:call TeachKey('h')<CR>
noremap  <buffer> <Right>    <Esc>:call TeachKey('l')<CR>
noremap  <buffer> <Up>       <Esc>:call TeachKey('k')<CR>
noremap  <buffer> <Down>     <Esc>:call TeachKey('j')<CR>
noremap  <buffer> <PageUp>   <Esc>:call TeachKey('Ctrl+B')<CR>
noremap  <buffer> <PageDown> <Esc>:call TeachKey('Ctrl+F')<CR>
inoremap <buffer> <Left>     <Esc>:call TeachKey('h')<CR>
inoremap <buffer> <Right>    <Esc>:call TeachKey('l')<CR>
inoremap <buffer> <Up>       <Esc>:call TeachKey('k')<CR>
inoremap <buffer> <Down>     <Esc>:call TeachKey('j')<CR>
inoremap <buffer> <PageUp>   <Esc>:call TeachKey('Ctrl+B')<CR>
inoremap <buffer> <PageDown> <Esc>:call TeachKey('Ctrl+F')<CR>

noremap  <buffer> <del> <esc>:<c-u>!sl<cr>
inoremap <buffer> <del> <esc>:<c-u>!sl<cr>
noremap  <buffer> <backspace> <esc>:<c-u>!sl<cr>
inoremap <buffer> <backspace> <esc>:<c-u>!sl<cr>

