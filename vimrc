" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

nnoremap <Leader>j :!rm -f ~/winhome/Desktop/pittouch.zip &&  zip -r ~/winhome/Desktop/pittouch.zip pittouch/* -x G*<CR>

set runtimepath+=~/.vim/
runtime! config/*.vim

