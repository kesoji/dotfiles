" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

" Common mapping. Can be used for IdeaVim

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
nnoremap <C-]> g<C-]>

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

""" <ESC>
inoremap jj <ESC>
inoremap jk <ESC>
inoremap jl <ESC><Right>

""" Location List / QuickFix
""" MEMO: Use [q, ]q for QuickFix! ([l, ]l can also be used for Location List.)
nnoremap <C-n> :lne<CR>
nnoremap <C-p> :lp<CR>
nnoremap <Leader>a :cclose<CR>
nnoremap <Leader><Leader>a :lclose<CR>

""" Tab mapping
nnoremap <S-Tab> <<
inoremap <S-Tab> <C-d>

""" Search and Replace
noremap  n nzzzv
noremap  N Nzzzv
nnoremap / /\v
nnoremap ? ?\v
cnoremap s// s//
cnoremap g// g//
cnoremap v// v//
nnoremap gs :<C-u>%s/\v//g<Left><Left><Left><C-f>i
vnoremap gs :s/\v//g<Left><Left><Left><C-f>i
vnoremap gsg y:%s/\v<C-r>"//gc<Left><Left><Left><C-f>i
nnoremap <Leader>vp :vim  ** \| cw<Left><Left><Left><Left><Left><Left><Left><Left>
nnoremap <Esc><Esc> :<C-u>nohlsearch<CR>
nnoremap <Space><Space> "zyiw:let @/ = '\<' . @z . '\>'<CR>:set hlsearch<CR>
vnoremap <Space><Space> "zy:let @/ = @z<CR>:set hlsearch<CR>

""" Window and Tab operation
nnoremap s <Nop>
"nnoremap sj <C-w>j
"nnoremap sk <C-w>k
"nnoremap sl <C-w>l
"nnoremap sh <C-w>h
"nnoremap sJ <C-w>J
"nnoremap sK <C-w>K
"nnoremap sL <C-w>L
"nnoremap sH <C-w>H
"nnoremap sr <C-w>r
"nnoremap s= <C-w>=
"nnoremap sw <C-w>w
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
"nnoremap ss :<C-u>sp<CR>
"nnoremap sv :<C-u>vs<CR>
nnoremap sq :<C-u>q<CR>
nnoremap sQ :<C-u>bd<CR>

""" Utility
nnoremap c. q:<UP><CR>

""" Command Mode
cnoremap <C-n> <Down>
cnoremap <C-p> <Up>
"cnoremap <C-b> <Left>
"cnoremap <C-f> <Right>
cnoremap <C-a> <Home>
cnoremap <C-e> <End>
"cnoremap <C-d> <Del>
"
""" Hack
"ビジュアルモードで連続ペースト
vnoremap <expr> p 'pgv"'.v:register.'y`>'
vnoremap <expr> P 'Pgv"'.v:register.'y`>'
