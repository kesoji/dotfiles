" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

if !&compatible
    set nocompatible
endif
set encoding=utf-8
set fileencoding=utf-8
if has('vim_starting')
    set fileencodings+=cp932
endif
scriptencoding utf-8
set background=dark
" these setting are overridden by .gvimrc.
try
    colorscheme hybrid
catch
    try
        colorscheme molokai
    catch
        colorscheme desert
    endtry
endtry

" Anywhere SID.
function! s:SID_PREFIX()
    return matchstr(expand('<sfile>'), '<SNR>\d\+_\zeSID_PREFIX$')
endfunction

" Set tabline.
function! s:my_tabline()  "{{{
    let s = ''
    for i in range(1, tabpagenr('$'))
        let bufnrs = tabpagebuflist(i)
        let bufnr = bufnrs[tabpagewinnr(i) - 1]  " first window, first appears
        let no = i  " display 0-origin tabpagenr.
        let mod = getbufvar(bufnr, '&modified') ? '!' : ' '
        let title = fnamemodify(bufname(bufnr), ':t')
        let title = '[' . title . ']'
        let s .= '%'.i.'T'
        let s .= '%#' . (i == tabpagenr() ? 'TabLineSel' : 'TabLine') . '#'
        let s .= no . ':' . title
        let s .= mod
        let s .= '%#TabLineFill# '
    endfor
    let s .= '%#TabLineFill#%T%=%#TabLine#'
    return s
endfunction "}}}
let &tabline = '%!'. s:SID_PREFIX() . 'my_tabline()'
set showtabline=2 " 常にタブラインを表示

" Mapping {{{1
let mapleader = ','
noremap \ ,

" <C-u>は、範囲指定(数字入力)を削除
nnoremap <Space>w :<C-u>w<CR>
nnoremap <Space>W :<C-u>wq<CR>
nnoremap <Space>q :<C-u>q<CR>
nnoremap <Space><Space>q :<C-u>qa<CR>
nnoremap <Space>Q :<C-u>q!<CR>

nnoremap ; :
nnoremap : ;
vnoremap ; :
vnoremap : ;

" Tab mapping
nnoremap <S-Tab> <<
inoremap <S-Tab> <C-d>

inoremap <silent>jj <ESC>
inoremap <silent>jk <ESC>

nnoremap <Space>o :<C-u>for i in range(v:count1) \| call append(line('.'), '') \| endfor<CR>
nnoremap <Space>O :<C-u>for i in range(v:count1) \| call append(line('.')-1, '') \| endfor<CR>

nmap / /\v
cmap s/ s/\v
nnoremap gs :<C-u>%s/\v//g<Left><Left><Left>
vnoremap gs :s/\v//g<Left><Left><Left>

" tagsジャンプの時に複数ある時は一覧表示
nnoremap <C-]> g<C-]>

nnoremap <Esc><Esc> :<C-u>nohlsearch<CR>
nnoremap <Space>h ^
nnoremap <Space>l $

nnoremap s <Nop>
nnoremap sj <C-w>j
nnoremap sk <C-w>k
nnoremap sl <C-w>l
nnoremap sh <C-w>h
nnoremap sJ <C-w>J
nnoremap sK <C-w>K
nnoremap sL <C-w>L
nnoremap sH <C-w>H
nnoremap sr <C-w>r
nnoremap s= <C-w>=
nnoremap sw <C-w>w
nnoremap so <C-w>_<C-w>|
nnoremap s> <C-w>>
nnoremap s< <C-w><
nnoremap s+ <C-w>+
nnoremap s- <C-w>-
nnoremap sO <C-w>=
nnoremap sN :<C-u>bn<CR>
nnoremap sP :<C-u>bp<CR>
nnoremap sn gt
nnoremap sp gT
for n in range(1, 9)
    execute 'nnoremap <silent> s'.n  ':<C-u>tabnext'.n.'<CR>'
endfor
nnoremap st :<C-u>tabnew<CR>
nnoremap sx :<C-u>tabclose<CR>
nnoremap ss :<C-u>sp<CR>
nnoremap sv :<C-u>vs<CR>
nnoremap sq :<C-u>q<CR>
nnoremap sQ :<C-u>bd<CR>

" http://itchyny.hatenablog.com/entry/2014/12/25/090000
nnoremap Y y$
nnoremap + <C-a>
nnoremap - <C-x>

" New in Vim8 http://itchyny.hatenablog.com/entry/2016/09/13/000000
cnoremap <C-n> <C-g>
cnoremap <C-p> <C-t>

inoremap japp <ESC>:<C-u>set noimdisable<CR>a

"User Defined Command {{{1
command! -nargs=+ -complete=command Capture QuickRun -type vim -src <q-args>
command! JsonFormat :execute '%!python -m json.tool'
            \ | :execute '%!python -c "import re,sys;chr=__builtins__.__dict__.get(\"unichr\",chr);sys.stdout.write(re.sub(r''\\u[0-9a-f]{4}'', lambda x: chr(int(\"0x\" + x.group(0)[2:], 16)).encode(\"utf-8\"), sys.stdin.read()))"'
            \ | :set filetype=json | :1
command! -nargs=? Jq call s:Jq(<f-args>)
            \ | :set filetype=json
function! s:Jq(...)
    if 0 == a:0
        let l:arg = "."
    else
        let l:arg = a:1
    endif
    " execute "%! jq 95fe1a73-e2e2-4737-bea1-a44257c50fc8quot;" . l:arg . "95fe1a73-e2e2-4737-bea1-a44257c50fc8quot;"
    execute "%!jq " . l:arg
endfunction

" AutoGroup {{{1
" バイナリ編集(xxd)モード（vim -b での起動、もしくは *.bin ファイルを開くと発動します）
" http://d.hatena.ne.jp/rdera/20081022/1224682665
augroup BinaryXXD
  autocmd!
  autocmd BufReadPre  *.bin let &binary =1
  autocmd BufReadPost * if &binary | silent %!xxd -g 1
  autocmd BufReadPost * set ft=xxd | endif
  autocmd BufWritePre * if &binary | %!xxd -r | endif
  autocmd BufWritePost * if &binary | silent %!xxd -g 1
  autocmd BufWritePost * set nomod | endif
augroup END
