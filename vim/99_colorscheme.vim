" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

set background=dark
" these setting are overridden by .gvimrc.
try
    colorscheme gruvbox
    "colorscheme hybrid
catch
    try
        colorscheme molokai
    catch
        colorscheme desert
    endtry
endtry
