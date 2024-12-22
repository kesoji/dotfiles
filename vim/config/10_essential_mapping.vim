" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
" Essential Mapping / Used for other text editor's plugin
""""""""""""""""""""""""""""""""""""""""""""""""""""""""""

""" <ESC>
inoremap jj <ESC>
inoremap jk <ESC>
inoremap jl <ESC><Right>

""" Editing
"xでレジスタに入れない
nnoremap x "_x

""" 終了 (TIPS: <C-u>は、 先頭まで削除。 基本的には範囲指定が混入した際の対処)
nnoremap <Leader>w :<C-u>w<CR>
nnoremap <Leader>W :<C-u>wq<CR>
nnoremap <Leader>q :<C-u>q<CR>
nnoremap <Leader><Leader>q :<C-u>qa<CR>
nnoremap <Leader>Q :<C-u>q!<CR>
nnoremap <Leader><Leader>Q :<C-u>qa!<CR>

""" ベースの動きをスワップ
"noremap ; :
noremap j gj
noremap k gk
noremap gj j
noremap gk k

"tagsジャンプの時に複数ある時は一覧表示
"nnoremap <C-]> g<C-]>

noremap + <C-a>
noremap - <C-x>
noremap gp "0p
noremap gP "0P

""" Moving
noremap <Leader>h ^
noremap <Leader>H 0
noremap <Leader>l $
noremap <c-i> <c-i>zz
noremap <c-o> <c-o>zz
