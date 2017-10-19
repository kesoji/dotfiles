" .vim/after/ftplugin/python.vim

if exists('b:did_ftplugin_python')
    finish
endif
let b:did_ftplugin_python = 1

setlocal smarttab
setlocal expandtab
setlocal tabstop=4
setlocal shiftwidth=4
setlocal foldmethod=indent
setlocal commentstring=#%s

" - af: a function
" - if: inner function
" - ac: a class
" - ic: inner class

" this plugin has aditional key-bind
"  -  '[pf', ']pf': move to next/previous function
"  -  '[pc', ']pc': move to next/previous class
xmap <buffer> af <Plug>(textobj-python-function-a)
omap <buffer> af <Plug>(textobj-python-function-a)
xmap <buffer> if <Plug>(textobj-python-function-i)
omap <buffer> if <Plug>(textobj-python-function-i)
xmap <buffer> ac <Plug>(textobj-python-class-a)
omap <buffer> ac <Plug>(textobj-python-class-a)
xmap <buffer> ic <Plug>(textobj-python-class-i)
omap <buffer> ic <Plug>(textobj-python-class-i)


if exists('b:current_after_syntax')
    finish
endif

let s:cpo_save = &cpo
set cpo&vim

" FIXME 効いていない..どこかで上書きされている..？
syn match pythonOperator "\(+\|=\|-\|\^\|\*\)"
syn match pythonDelimiter "\(,\|\.\|:\)"
syn keyword pythonSpecialWord self

hi link pythonSpecialWord   Special
hi link pythonDelimiter     Special

let b:current_after_syntax = 'python'

let &cpo = s:cpo_save
unlet s:cpo_save
