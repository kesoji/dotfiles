" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

" Common mapping. Can be used for IdeaVim


""" Location List / QuickFix
""" MEMO: Use [q, ]q for QuickFix! ([l, ]l can also be used for Location List.)
nnoremap <C-n> :lne<CR>
nnoremap <C-p> :lp<CR>
nnoremap <Leader>a :cclose<CR>
nnoremap <Leader><Leader>a :lclose<CR>

""" Tab mapping nnoremap <S-Tab> <<
inoremap <S-Tab> <C-d>

""" Search and Replace
"" zz: カーソル位置を中央に移動, zv: フォールディングを解除
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
"nnoremap s <Nop>
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
"nnoremap so <C-w>_<C-w>|
"nnoremap s> <C-w>>
"nnoremap s< <C-w><
"nnoremap s+ <C-w>+
"nnoremap s- <C-w>-
"nnoremap sO <C-w>=
"nnoremap sN :<C-u>bn<CR>
"nnoremap sP :<C-u>bp<CR>
"nnoremap sn gt
"nnoremap sp gT
"for n in range(1, 9)
"    execute 'nnoremap <silent> s'.n  ':<C-u>tabnext'.n.'<CR>'
"endfor
"nnoremap st :<C-u>tabnew<CR>
"nnoremap sx :<C-u>tabclose<CR>
"nnoremap ss :<C-u>sp<CR>
"nnoremap sv :<C-u>vs<CR>
"nnoremap sq :<C-u>q<CR>
"nnoremap sQ :<C-u>bd<CR>

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
