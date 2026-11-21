" vim: foldmethod=marker foldlevel=0 fenc=utf-8
" Vim はたまに使う程度なので、設定は小さく保つ。メインは Neovim（nvim/）。
" プラグインは vim-plug で数個だけ。入れるときは手で :PlugInstall を流す（自動では入れない）。

set encoding=utf-8
scriptencoding utf-8

" 起動時の準備 {{{1
if has('vim_starting')
  unlet! skip_defaults_vim
  if filereadable($VIMRUNTIME . '/defaults.vim')
    source $VIMRUNTIME/defaults.vim
  endif

  if has('win32') || has('win64')
    set directory=$TMP
    set backupdir=$TMP
    set undodir=$HOME/.vim/undo
    set runtimepath^=$HOME/.vim,$HOME/.vim/after
    set viminfo+=n$HOME/.viminfo
    source $HOME/.vim/mswin.vim
    " mswin.vim の <C-V> を、コマンドラインでは元に戻す
    cmap <C-V> <C-V>
  else
    set directory=~/.vim/swp
    set backupdir=~/.vim/backup
    set undodir=~/.vim/undo
  endif
endif

" IdeaVim・Neovim と共通の設定とキーマップ（~/.vim/config/ にある） {{{1
runtime config/00_essential_setting.vim
runtime config/10_essential_mapping.vim

" オプション {{{1
set fileencoding=utf-8
set fileencodings+=cp932
set fileformats=unix,dos,mac
set autowrite
set updatetime=100
set modelines=2
set spell
set spelllang=en,cjk
set shiftwidth=4 softtabstop=4 tabstop=4
set autoindent smartindent
set breakindent
set display=lastline
set pumheight=10
set showmatch matchtime=1
set whichwrap=[,],<,>,b,s
set hlsearch wrapscan
set ambiwidth=single
set belloff=all
set list listchars=tab:>-,trail:-
set completeopt=menu,preview,menuone,noselect
set wildmenu wildmode=longest,full
set diffopt=internal,filler,algorithm:histogram,indent-heuristic
set nostartofline
set laststatus=2
set shortmess+=c

augroup vimrc_filetype
  autocmd!
  autocmd FileType html,eruby,ruby,javascript,yaml,vim setlocal tabstop=2 softtabstop=2 shiftwidth=2
augroup END

if executable('rg')
  set grepprg=rg\ --vimgrep\ --no-heading
  set grepformat=%f:%l:%c:%m,%f:%l:%m
endif
augroup vimrc_grep
  autocmd!
  autocmd QuickFixCmdPost *grep* cwindow
augroup END

" Vim に付いてくる optional package {{{1
" comment: gc / gcc でコメント（Neovim と同じキー）、hlyank: ヤンクした所を光らせる
silent! packadd! matchit
silent! packadd! comment
silent! packadd! hlyank
silent! packadd! editorconfig

" キーマップ {{{1
noremap <silent> <F3> :set list! number!<CR>
inoremap <S-Tab> <C-d>
nnoremap Y y$

" Quickfix / Location list（移動は ]q [q。閉じるのはこちら）
nnoremap <Leader>a :cclose<CR>
nnoremap <Leader><Leader>a :lclose<CR>

" 検索と置換
noremap  n nzzzv
noremap  N Nzzzv
nnoremap / /\v
nnoremap ? ?\v
nnoremap gs :<C-u>%s/\v//g<Left><Left><Left><C-f>i
vnoremap gs :s/\v//g<Left><Left><Left><C-f>i
vnoremap gsg y:%s/\v<C-r>"//gc<Left><Left><Left><C-f>i
nnoremap <Leader>vp :vim  ** \| cw<Left><Left><Left><Left><Left><Left><Left><Left>
nnoremap <Esc><Esc> :<C-u>nohlsearch<CR>
nnoremap <Space><Space> "zyiw:let @/ = '\<' . @z . '\>'<CR>:set hlsearch<CR>
vnoremap <Space><Space> "zy:let @/ = @z<CR>:set hlsearch<CR>

" コマンドライン
nnoremap c. q:<UP><CR>
cnoremap <C-n> <Down>
cnoremap <C-p> <Up>
cnoremap <C-a> <Home>
cnoremap <C-e> <End>

" ビジュアルモードで続けて貼る
vnoremap <expr> p 'pgv"'.v:register.'y`>'
vnoremap <expr> P 'Pgv"'.v:register.'y`>'

" 空行を足す
nnoremap <Leader>o :<C-u>for i in range(v:count1) \| call append(line('.'), '') \| endfor<CR>
nnoremap <Leader>O :<C-u>for i in range(v:count1) \| call append(line('.')-1, '') \| endfor<CR>

nnoremap <Leader>ev :vsplit $MYVIMRC<CR>
nnoremap <Leader>sv :source $MYVIMRC<CR>

" 端末
tnoremap <ESC> <C-\><C-n>

" コマンド {{{1
command! ForceOverwrite w !sudo tee >/dev/null %
command! DiffOrig vert new | set bt=nofile | r ++edit # | 0d_ | diffthis | wincmd p | diffthis
command! CD cd %:h
command! LCD lcd %:h
command! -nargs=? Jq execute '%!jq ' . (empty(<q-args>) ? '.' : <q-args>) | set filetype=json

" プラグイン（vim-plug） {{{1
" plug.vim が無いときは、プラグイン無しで起動する
if !empty(globpath(&runtimepath, 'autoload/plug.vim'))
  call plug#begin('~/.vim/plugged')
  Plug 'tpope/vim-surround'
  Plug 'junegunn/fzf'
  Plug 'junegunn/fzf.vim'
  Plug 'airblade/vim-gitgutter'
  Plug 'morhetz/gruvbox'
  call plug#end()
endif

" fzf.vim（キーは LazyVim に寄せる。<Space><Space> は上の単語ハイライトのまま）
if exists('g:plugs') && has_key(g:plugs, 'fzf.vim')
  nnoremap <Leader>ff :<C-u>Files<CR>
  nnoremap <Leader>fg :<C-u>GFiles<CR>
  nnoremap <Leader>fb :<C-u>Buffers<CR>
  nnoremap <Leader>fr :<C-u>History<CR>
  nnoremap <Leader>/ :<C-u>RG<CR>
  nnoremap <Leader>sg :<C-u>RG<CR>
  nnoremap <expr> g* ':RG ' . expand('<cword>') . '<CR>'
endif

" vim-gitgutter（]h [h で次・前の変更。LazyVim と同じ）
if exists('g:plugs') && has_key(g:plugs, 'vim-gitgutter')
  nmap ]h <Plug>(GitGutterNextHunk)
  nmap [h <Plug>(GitGutterPrevHunk)
  nmap <Leader>d <Plug>(GitGutterPreviewHunk)
endif

" 配色 {{{1
set background=dark
if has('termguicolors')
  set termguicolors
endif
try
  colorscheme gruvbox
catch
  try
    colorscheme retrobox
  catch
    colorscheme desert
  endtry
endtry
