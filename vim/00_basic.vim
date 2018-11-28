" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

set encoding=utf-8
set fileencoding=utf-8
set fileformats=unix,dos,mac
scriptencoding utf-8

if has('vim_starting')
    unlet! skip_defaults_vim
    source $VIMRUNTIME/defaults.vim

    " Avoid Duplication
    set fileencodings+=cp932
    set clipboard+=autoselect,unnamed
    let $PATH = expand("~/.pyenv/shims") . ":" . $PATH
    let $PATH = expand("~/.plenv/shims") . ":" . $PATH

    if has('win32') || has('win64')
        set directory=$TMP
        set backupdir=$TMP
        set undodir=$HOME/.vim/undo
        set runtimepath^=$HOME/.vim,$HOME/.vim/after
        set viminfo+=n$HOME/.viminfo

        source $HOME/.vim/mswin.vim

        " Disable mswin.vim's C-V mapping
        " imap <C-V> <C-V>
        cmap <C-V> <C-V>
    else
        " Mac or Linux
        set directory=~/.vim/swp
        set backupdir=~/.vim/backup
        set undodir=~/.vim/undo
    endif
endif

set autowrite
set updatetime=100

" workaround for long long line.
"set synmaxcol=400

" Windows or Mac/Linux? {{{1

" 縦分割時の速度改善
" http://qiita.com/kefir_/items/c725731d33de4d8fb096
if has("vim_starting") && !has('gui_running') && has('vertsplit')
  function! EnableVsplitMode()
    " enable origin mode and left/right margins
    let &t_CS = "y"
    let &t_ti = &t_ti . "\e[?6;69h"
    let &t_te = "\e[?6;69l\e[999H" . &t_te
    let &t_CV = "\e[%i%p1%d;%p2%ds"
    call writefile([ "\e[?6;69h" ], "/dev/tty", "a")
  endfunction

  " old vim does not ignore CPR
  map <special> <Esc>[3;9R <Nop>

  " new vim can't handle CPR with direct mapping
  " map <expr> ^[[3;3R EnableVsplitMode()
  set t_F9=[3;3R
  map <expr> <t_F9> EnableVsplitMode()
  let &t_RV .= "\e[?6;69h\e[1;3s\e[3;9H\e[6n\e[0;0s\e[?6;69l"
endif

" 基本設定 {{{1
set hidden

set modeline
set modelines=2

set spell
set spelllang=en,cjk

""" cursorline is slow..
" set cursorline
set history=1000
"set tabstop=4
set expandtab
set smarttab
set textwidth=0
set virtualedit=block "can edit virtual area!
" set nowrap
set shiftwidth=4
set number
set autoindent
set smartindent
" http://itchyny.hatenablog.com/entry/2014/12/25/090000
source $VIMRUNTIME/macros/matchit.vim
set display=lastline
set pumheight=10
set showmatch
set matchtime=1
" New in Vim8 http://itchyny.hatenablog.com/entry/2016/09/13/000000
if version >= 800
    set breakindent
endif

" set whichwrap=h,l,[,],<,>,b,s           "h,l,<-,->,backspace,spaceで上下の行に回り込む
set whichwrap=[,],<,>,b,s           "<-,->,backspace,spaceで上下の行に回り込む
set backspace=indent,eol,start

set hlsearch
set ignorecase
set smartcase
set wrapscan    "default

set ambiwidth=double

set belloff=all

set list
" set listchars=tab:>-,trail:-,nbsp:%,extends:>,precedes:<,eol:<
set listchars=tab:>-,trail:-
noremap <silent> <F3> :set list! number!<CR>

set completeopt=menu,preview,menuone,noselect
set infercase

"autocmd InsertEnter * set list
"autocmd InsertLeave * set nolist

set wildmenu
set wildmode=list,longest,full "command-line-modeのリスト表示

" Mapping {{{1
let mapleader = "\<Space>"

""" Editing
"xでレジスタに入れない
nnoremap x "_x

""" 終了 (TIPS: <C-u>は、 先頭まで削除。 基本的には範囲指定が混入した際の対処)
nnoremap <Leader>w :<C-u>w<CR>
nnoremap <Leader>W :<C-u>wq<CR>
nnoremap <Leader>q :<C-u>q<CR>
nnoremap <Leader><Leader>q :<C-u>qa<CR>
nnoremap <Leader>Q :<C-u>q!<CR>

""" ベースの動きをスワップ
"noremap ; :
noremap j gj
noremap k gk
noremap gj j
noremap gk k
"tagsジャンプの時に複数ある時は一覧表示
"nnoremap <C-]> g<C-]>

""" Moving
noremap <Leader>h ^
noremap <Leader>H 0
noremap <Leader>l $

""" <ESC>
inoremap <silent>jj <ESC>
inoremap <silent>jk <ESC>
inoremap <silent>jl <ESC><Right>

""" Location List / QuickFix
""" MEMO: Use [q, ]q for QuickFix! ([l, ]l can also be used for Location List.)
nnoremap <C-n> :lne<CR>
nnoremap <C-p> :lp<CR>
nnoremap <Leader>a :cclose<CR>
nnoremap <Leader><Leader>a :lclose<CR>

""" Tab mapping
nnoremap <S-Tab> <<
inoremap <S-Tab> <C-d>

nnoremap <Leader>o :<C-u>for i in range(v:count1) \| call append(line('.'), '') \| endfor<CR>
nnoremap <Leader>O :<C-u>for i in range(v:count1) \| call append(line('.')-1, '') \| endfor<CR>

""" Completion
inoremap <expr> <C-j> pumvisible() ? "\<Down>" : "\<C-x>\<C-o>"
inoremap <expr> <Tab> pumvisible() ? "\<CR>" : "\<Tab>"

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
nnoremap <silent> <Space><Space> "zyiw:let @/ = '\<' . @z . '\>'<CR>:set hlsearch<CR>
vnoremap <silent> <Space><Space> "zy:let @/ = @z<CR>:set hlsearch<CR>

""" Window and Tab operation
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

nnoremap <Leader>ev :vsplit $MYVIMRC<CR>
nnoremap <Leader>sv :source $MYVIMRC<CR>
nnoremap <Leader>egv :vsplit $MYGVIMRC<CR>
nnoremap <Leader>sgv :source $MYGVIMRC<CR>

noremap + <C-a>
noremap - <C-x>

noremap gp "0p
noremap gP "0P

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

""" Text usabiity improvement
inoremap japp <ESC>:<C-u>set noimdisable<CR>a
set pastetoggle=<F12>

""" Command Mode Editing{{{1
:cabbrev ga2 g/^/ if (line(".") % 2 == 1) <BAR>
:cabbrev ga3 g/^/ if (line(".") % 3 == 1) <BAR>
:cabbrev ga4 g/^/ if (line(".") % 4 == 1) <BAR>
:cabbrev ga5 g/^/ if (line(".") % 5 == 1) <BAR>

""" Hack
"ビジュアルモードで連続ペースト
vnoremap <expr> p 'pgv"'.v:register.'y`>'
vnoremap <expr> P 'Pgv"'.v:register.'y`>'

"User Defined Command {{{1
"" ForceOverwrite - force write if readonly
command! ForceOverwrite w !sudo tee >/dev/null %
"" DiffOrig - how did I edit this file? {{{2
command! DiffOrig vert new | set bt=nofile | r ++edit # | 0d_ | diffthis | wincmd p | diffthis
"" Capture - view command result in QuickRun window {{{2
command! -nargs=+ -complete=command Capture QuickRun -type vim -src <q-args>
"" JsonFormat - format json {{{2
command! JsonFormat :execute '%!python -m json.tool'
            \ | :execute '%!python -c "import re,sys;chr=__builtins__.__dict__.get(\"unichr\",chr);sys.stdout.write(re.sub(r''\\u[0-9a-f]{4}'', lambda x: chr(int(\"0x\" + x.group(0)[2:], 16)).encode(\"utf-8\"), sys.stdin.read()))"'
            \ | :set filetype=json | :1
"" Jq - use system jq in vim {{{2
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

"" VO - insert output of vim command in current buffer {{{2
command! -narg=+ VO :call ViewOutput(<q-args>)
function! ViewOutput(cmd)
    let save_reg=@a
    redir @a
    silent exec a:cmd
    redir END
    put a
    let @a=save_reg
endfunction

"" UnMinify Simple re-format for minified Javascript {{{2
command! UnMinify call UnMinify()
function! UnMinify()
    %s/{\ze[^\r\n]/{\r/g
    %s/){/) {/g
    %s/};\?\ze[^\r\n]/\0\r/g
    %s/;\ze[^\r\n]/;\r/g
    %s/[^\s]\zs[=&|]\+\ze[^\s]/ \0 /g
    normal ggVG=
endfunction

"" CD/LCD - cd to current file dir {{{2
command! CD cd %:h
command! LCD lcd %:h

"" SWPCLR - delete swp files {{{2
command! SWPCLR :execute '!rm -rf ~/.vim/swp/*'


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

augroup vimrc_loading
    autocmd!
    autocmd BufRead,BufNewFile *.vim    setfiletype vim
    autocmd BufNewFile *.pl 0r $HOME/.vim/template/perl-script.txt
    autocmd BufNewFile *.t  0r $HOME/.vim/template/perl-test.txt
augroup END

" Perl {{{1
noremap ,pt <Esc>:%! perltidy -se<CR>
noremap ,ptv <Esc>:'<,'>! perltidy -se<CR>

" GREP {{{1
augroup grepQuickfixOpen
    autocmd QuickFixCmdPost *grep* cwindow
augroup END
if executable('rg')
    set grepprg=rg\ --vimgrep\ --no-heading
    set grepformat=%f:%l:%c:%m,%f:%l:%m
endif
nnoremap <expr> * ':vimgrep ' . expand('<cword>') . ' %<CR>'
" https://qiita.com/yuku_t/items/0c1aff03949cb1b8fe6b
