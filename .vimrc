" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

if !&compatible
    set nocompatible
endif
set encoding=utf-8
set fileencoding=utf-8
if has('vim_starting')
    set fileencodings+=cp932
endif

" Plugin Manager Settings {{{
" dein.vim本体
if has('win32') || has('win64')
    let s:dein_dir = $USERPROFILE . '\.cache\dein'
else
    let s:dein_dir = '~/.cache/dein'
endif

let s:dein_repo_dir = s:dein_dir . '/repos/github.com/Shougo/dein.vim'

if has('vim_starting')
    execute 'set runtimepath^=' . fnamemodify(s:dein_repo_dir, ':p')[0:-2]
endif

" deinがなければ落としてくる
if !isdirectory(fnamemodify(s:dein_repo_dir, ':p'))
    execute '!git clone https://github.com/Shougo/dein.vim' s:dein_repo_dir
endif

" プラグインリストを収めた TOML ファイル
let s:toml      = '~/.vim/rc/dein.toml'
let $MYDEIN = s:toml
let s:lazy_toml = '~/.vim/rc/dein_lazy.toml'
let $MYDEINL = s:lazy_toml

if dein#load_state(s:dein_dir)
    " TOMLを変更してからdein#clear_state()しなくてもよくなる、らしい。
    call dein#begin(s:dein_dir, [$MYVIMRC, s:toml, s:lazy_toml]) 
    call dein#load_toml(s:toml,      {'lazy': 0})
    call dein#load_toml(s:lazy_toml, {'lazy': 1})
    call dein#end()
    call dein#save_state()
endif

" もし、未インストールものものがあったらインストール
if dein#check_install()
    call dein#install()
endif

" Windows {{{1
if has('win32') || has('win64')
    set directory=$TMP
    set backupdir=$TMP
    set undodir=$HOME/.vim/undo
    source $HOME/.vim/mswin.vim

    " Disable mswin.vim's C-V mapping
    " imap <C-V> <C-V>
    cmap <C-V> <C-V>

    """"""""""""""""""""""""""""""
    " https://sites.google.com/site/fudist/Home/vim-nihongo-ban/kaoriya-trouble#plugin
    "
    " Kaoriya版に添付されているプラグインの無効化
    " 問題があるものもあるので一律に無効化します。
    " ファイルを参照(コメント部分で gf を実行)した上で、必要なプラグインは
    " let plugin_..._disableの設定行をコメント化(削除)して有効にして下さい。
    """"""""""""""""""""""""""""""
    "$VIM/plugins/kaoriya/plugin/autodate.vim
    let plugin_autodate_disable  = 1
    "$VIM/plugins/kaoriya/plugin/cmdex.vim
    let plugin_cmdex_disable     = 1
    "$VIM/plugins/kaoriya/plugin/dicwin.vim
    let plugin_dicwin_disable    = 1
    "$VIM/plugins/kaoriya/plugin/hz_ja.vim
    "let plugin_hz_ja_disable     = 1
    "$VIM/plugins/kaoriya/plugin/scrnmode.vim
    let plugin_scrnmode_disable  = 1
    "$VIM/plugins/kaoriya/plugin/verifyenc.vim
    "let plugin_verifyenc_disable = 1
else
    " Mac or Linux {{{1
    set directory=~/.vim/swp
    set backupdir=~/.vim/backup
    set undodir=~/.vim/undo
endif


" Memo 分割した設定ファイル(.vim/userautoload/*.vim)読み込み {{{1
" set runtimepath+=~/.vim/
" runtime! userautoload/*.vim

" 基本設定 {{{1
syntax enable
filetype plugin indent on

if has('clientserver')
    call singleton#enable()
endif

set modeline
set modelines=2

set cursorline
set history=1000
set tabstop=4
set expandtab
set textwidth=0
" set nowrap
set shiftwidth=4
set number
set autoindent
set smartindent
" http://itchyny.hatenablog.com/entry/2014/12/25/090000
set display=lastline
set pumheight=10
set showmatch
set matchtime=1
" New in Vim8 http://itchyny.hatenablog.com/entry/2016/09/13/000000
set breakindent

" set whichwrap=h,l,[,],<,>,b,s           "h,l,<-,->,backspace,spaceで上下の行に回り込む
set whichwrap=[,],<,>,b,s           "<-,->,backspace,spaceで上下の行に回り込む
set clipboard+=autoselect,unnamed

set incsearch
set hlsearch
set ignorecase

set list
" set listchars=tab:>-,trail:-,nbsp:%,extends:>,precedes:<,eol:<
set listchars=tab:>-,trail:-

set wildmode=longest:list "command-line-modeのリスト表示

autocmd BufRead,BufNewFile *.vim    setfiletype vim

" Style {{{1
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

" Tab {{{1
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

inoremap jk <ESC>

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

"<<<Plugin>>> jedi-vim {{{1
let g:jedi#auto_initialization = 1
let g:jedi#rename_command = "<leader>R"
let g:jedi#popup_on_dot = 1

"<<<Plugin>>> quickrun {{{1
"[quickrun.vim について語る - C++でゲームプログラミング](http://d.hatena.ne.jp/osyo-manga/20130311/1363012363)
let g:quickrun_config = {
\   "_" : {
\       "runner" : "vimproc",
\       "runner/vimproc/updatetime" : 100,
\       "outputter/buffer/split" : ":rightbelow vertical",
\       "outputter/buffer/close_on_empty" : 1,
\       "outputter" : "error",
\       "outputter/error/success" : "buffer",
\       "outputter/error/error" : "quickfix",
\       "hook/output_encode/encoding" : "utf-8",
\   },
\   "python": {
\       "hook/output_encode/encoding" : "sjis",
\   },
\}
            

inoremap \\r <ESC>:QuickRun<CR>
" <C-c> で実行を強制終了させる
" quickrun.vim が実行していない場合には <C-c> を呼び出す
nnoremap <expr><silent> <C-c> quickrun#is_running() ? quickrun#sweep_sessions() : "\<C-c>"

"<<<Plugin>>> NeoComplete {{{1
" Note: This option must set it in .vimrc(_vimrc).  NOT IN .gvimrc(_gvimrc)!
" Disable AutoComplPop. (only if using AutoComplPop)
"let g:acp_enableAtStartup = 0
" Use neocomplete.
let g:neocomplete#enable_at_startup = 1
" Use smartcase.
let g:neocomplete#enable_smart_case = 1
" Set minimum syntax keyword length.
let g:neocomplete#sources#syntax#min_keyword_length = 3
" neocomplcacheを自動的にロックするバッファ名のパターンを指定します。 ku.vimやfuzzyfinderなど、neocomplcacheと相性が悪いプラグインを使用する場合に設定します。
let g:neocomplete#lock_buffer_name_pattern = '\*ku\*'

" Define dictionary.
let g:neocomplete#sources#dictionary#dictionaries = {
            \ 'default' : '',
            \ 'vimshell' : $HOME.'/.vimshell_hist',
            \ 'scheme' : $HOME.'/.gosh_completions'
            \ }

" Define keyword.
if !exists('g:neocomplete#keyword_patterns')
    let g:neocomplete#keyword_patterns = {}
endif
let g:neocomplete#keyword_patterns['default'] = '\h\w*'

" Plugin key-mappings.
inoremap <expr><C-g>     neocomplete#undo_completion()
" Shell-like completion
inoremap <expr><C-l>     neocomplete#complete_common_string()

" Recommended key-mappings.
" <CR>: close popup and save indent.
inoremap <silent> <CR> <C-r>=<SID>my_cr_function()<CR>
function! s:my_cr_function()
    return (pumvisible() ? "\<C-y>" : "" ) . "\<CR>"
    " For no inserting <CR> key.
    "return pumvisible() ? "\<C-y>" : "\<CR>"
endfunction
" <TAB>: completion.
"inoremap <expr><TAB>  pumvisible() ? "\<C-n>" : "\<TAB>"
"inoremap <expr><S-TAB>  pumvisible() ? "\<C-p>" : "\<S-TAB>"
" <C-h>, <BS>: close popup and delete backword char.
inoremap <expr><C-h> neocomplete#smart_close_popup()."\<C-h>"
inoremap <expr><BS> neocomplete#smart_close_popup()."\<C-h>"

" Close popup by <Space>.
inoremap <expr><Space> pumvisible() ? "\<C-y>" : "\<Space>"

" AutoComplPop like behavior.
"let g:neocomplete#enable_auto_select = 1

" Shell like behavior(not recommended).
"set completeopt+=longest
"let g:neocomplete#enable_auto_select = 1
"let g:neocomplete#disable_auto_complete = 1
"inoremap <expr><TAB>  pumvisible() ? "\<Down>" : "\<C-x>\<C-u>"

" Enable omni completion.
autocmd FileType css setlocal omnifunc=csscomplete#CompleteCSS
autocmd FileType html,markdown setlocal omnifunc=htmlcomplete#CompleteTags
autocmd FileType javascript setlocal omnifunc=javascriptcomplete#CompleteJS
autocmd FileType python setlocal omnifunc=pythoncomplete#Complete
autocmd FileType xml setlocal omnifunc=xmlcomplete#CompleteTags

" Enable heavy omni completion.
if !exists('g:neocomplete#sources#omni#input_patterns')
    let g:neocomplete#sources#omni#input_patterns = {}
endif
"let g:neocomplete#sources#omni#input_patterns.php = '[^. \t]->\h\w*\|\h\w*::'
"let g:neocomplete#sources#omni#input_patterns.c = '[^.[:digit:] *\t]\%(\.\|->\)'
"let g:neocomplete#sources#omni#input_patterns.cpp = '[^.[:digit:] *\t]\%(\.\|->\)\|\h\w*::'

" For perlomni.vim setting.
" https://github.com/c9s/perlomni.vim
let g:neocomplete#sources#omni#input_patterns.perl = '\h\w*->\h\w*\|\h\w*::'

"<<<Plugin>>> NeoSnippets"{{{1
let g:neosnippet#snippets_directory='~/.vim/snippets'

imap <C-k>     <Plug>(neosnippet_expand_or_jump)
smap <C-k>     <Plug>(neosnippet_expand_or_jump)
xmap <C-k>     <Plug>(neosnippet_expand_target)"

" SuperTab like snippets behavior.
imap <expr><TAB> pumvisible() ? "\<C-n>"
            \ : neosnippet#expandable_or_jumpable() ?
            \ "\<Plug>(neosnippet_expand_or_jump)"
            \ : "\<TAB>"

smap <expr><TAB> neosnippet#expandable_or_jumpable() ? "\<Plug>(neosnippet_expand_or_jump)"
            \ : "\<TAB>"

" For snippet_complete marker.
if has('conceal')
    set conceallevel=2 concealcursor=i
endif

"<<<Plugin>>> Unite {{{1
" set prefix
nnoremap [unite] <Nop>
nmap <Space>f [unite]
let g:unite_enable_start_insert=1
let g:unite_source_history_yank_enable =1
let g:unite_source_file_mru_limit = 100
"file_mruの表示フォーマットを指定。空にすると表示スピードが高速化される
let g:unite_source_file_mru_filename_format = ''

"現在開いているファイルのディレクトリ下のファイル一覧。
"開いていない場合はカレントディレクトリ
nnoremap <silent> [unite]f :<C-u>UniteWithBufferDir -buffer-name=files file<CR>
"カスタムsubstitute用
nnoremap <silent> [unite]d :<C-u>Unite -buffer-name=file file<CR>
"バッファ一覧
nnoremap <silent> [unite]b :<C-u>Unite buffer<CR>
"レジスタ一覧
nnoremap <silent> [unite]r :<C-u>Unite -buffer-name=register register<CR>
"最近使用したファイルと一覧
nnoremap <silent> [unite]m :<C-u>Unite file_mru<CR>
"ブックマーク一覧
nnoremap <silent> [unite]e :<C-u>Unite bookmark<CR>
"ブックマークに追加
nnoremap <silent> [unite]a :<C-u>UniteBookmarkAdd<CR>
"VimFilerで絞り込み
nnoremap <silent> 0 :<C-u>Unite file -default-action=vimfiler<CR>

nnoremap sT :<C-u>Unite tab<CR>
nnoremap sb :<C-u>Unite buffer_tab -buffer-name=file<CR>
nnoremap sB :<C-u>Unite buffer -buffer-name=file<CR>

"uniteを開いている間のキーマッピング
augroup vimrc
    autocmd FileType unite call s:unite_my_settings()
augroup END
function! s:unite_my_settings()
    "ESCでuniteを終了
    nmap <buffer> <ESC> <Plug>(unite_exit)
    "入力モードのときjjでノーマルモードに移動
    imap <buffer> jj <Plug>(unite_insert_leave)
    "入力モードのときctrl+wでバックスラッシュも削除
    imap <buffer> <C-w> <Plug>(unite_delete_backward_path)
    "sでsplit
    nnoremap <silent><buffer><expr> s unite#smart_map('s', unite#do_action('split'))
    inoremap <silent><buffer><expr> s unite#smart_map('s', unite#do_action('split'))
    "vでvsplit
    nnoremap <silent><buffer><expr> v unite#smart_map('v', unite#do_action('vsplit'))
    inoremap <silent><buffer><expr> v unite#smart_map('v', unite#do_action('vsplit'))
    "fでvimfiler
    nnoremap <silent><buffer><expr> f unite#smart_map('f', unite#do_action('vimfiler'))
    inoremap <silent><buffer><expr> f unite#smart_map('f', unite#do_action('vimfiler'))
    " http://thinca.hatenablog.com/entry/20101027/1288190498
    call unite#custom#substitute('file', '[^~.]\zs/', '*/*', 20)
    call unite#custom#substitute('file', '/\ze[^*]', '/*', 10)
    call unite#custom#substitute('file', '^@@', '\=fnamemodify(expand("#"), ":p:h")."/*"', 2)
    call unite#custom#substitute('file', '^@', '\=getcwd()."/*"', 1)
    call unite#custom#substitute('file', '\*\*\+', '*', -1)
endfunction

" [agでvimの検索関連を高速化 - Qiita](http://qiita.com/0829/items/7053b6e3371592e4fbe6)
if executable('pt')
    let g:unite_source_grep_command = 'pt'
    let g:unite_source_grep_default_opts = '--nogroup --nocolor'
    let g:unite_source_grep_recursive_opt = ''
    let g:unite_source_grep_encoding = 'utf-8'
    let g:ag_prg="pt --vimgrep --smart-case"
elseif executable('ag')
    let g:unite_source_grep_command = 'ag'
    let g:unite_source_grep_default_opts = '--nogroup --nocolor'
    let g:unite_source_grep_recursive_opt = ''
    let g:unite_source_grep_encoding = 'utf-8'
    let g:ag_prg="ag --vimgrep --smart-case"
endif

nnoremap <silent> ,g :<C-u>Unite grep:. -buffer-name=search-buffer<CR>
nnoremap <silent> ,cg :<C-u>Unite grep:. -buffer-name=search-buffer<CR><C-R><C-W>
nnoremap <silent> ,sg  :<C-u>UniteResume search-buffer<CR>
vnoremap ,g y:Unite grep::-iHRn:<C-R>=escape(@", '\\.*$^[]')<CR><CR>



" Markdown {{{1

"<<<Plugin>>> Vim-Markdown [plasticboy/vim-markdown](https://github.com/plasticboy/vim-markdown){{{2
" let g:vim_markdown_folding_disabled = 1
let g:vim_markdown_folding_level = 2
" let g:vim_markdown_emphasis_multiline = 0
" let g:vim_markdown_conceal = 0

"<<<Plugin>>> previm {{{2
augroup PrevimSettings
    autocmd!
    autocmd BufNewFile,BufRead *.{md,mdwn,mkd,mkdn,mark*} set filetype=markdown
augroup END

let g:previm_enable_realtime = 1

"<<<Plugin>>> OpenBrowser {{{1
let g:netrw_nogx = 1 " disable netrw's gx mapping.
nmap <C-l> <Plug>(openbrowser-smart-search)
vmap <C-l> <Plug>(openbrowser-smart-search)

"<<<Plugin>>> lightline {{{1
set laststatus=2

"<<<Plugin>>> session {{{1
command! -nargs=* -complete=command OS OpenSession
command! -nargs=* -complete=command SS SaveSession

"<<<Plugin>>> VimFiler {{{1
command! V VimFiler
command! VB VimFilerBufferDir
command! VC VimFilerCurrentDir
command! VT VimFilerTab
nnoremap <F2> :VimFiler -buffer-name=explorer -split -simple -winwidth=40 -toggle -no-quit<CR>
let g:vimfiler_as_default_explorer = 1
let g:vimfiler_edit_action = 'tabopen'
let g:vimfiler_enable_auto_cd = 1

"<<<Plugin>>> vim-session {{{1
if has('win32') || has('win64')
    let g:session_directory = $HOME . '/.vim/sessions'
endif

" 現在のディレクトリ直下の .vimsessions/ を取得 
let s:local_session_directory = xolox#misc#path#merge(getcwd(), '.vimsessions')
" 存在すれば
if isdirectory(s:local_session_directory)
    " session保存ディレクトリをそのディレクトリの設定
    let g:session_directory = s:local_session_directory
    " vimを辞める時に自動保存
    let g:session_autosave = 'yes'
    " 引数なしでvimを起動した時にsession保存ディレクトリのdefault.vimを開く
    let g:session_autoload = 'yes'
    " 1分間に1回自動保存
    let g:session_autosave_periodic = 1
else
    let g:session_autosave = 'no'
    let g:session_autoload = 'no'
endif
unlet s:local_session_directory

"<<<Plugin>>> vim-json {{{1
let g:vim_json_syntax_conceal = 0


"<<<Plugin>>> syntastic {{{1
set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*
let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_loc_list_height = 6
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0

let g:syntastic_enable_perl_checker = 1
let g:syntastic_perl_checkers = ['perl', 'podchecker']
let g:syntastic_javascript_checkers = ['eslint']

"<<<Plugin>>> indentLine {{{1
" let g:indentLine_faster = 1

"<<<Plugin>>> vim-easymotion {{{1
let g:EasyMotion_do_mapping = 0
let g:EasyMotion_keys = ';HKLYUIOPNM,QWERTASDGZXCVBJF'
" Show target key with upper case to improve readability
let g:EasyMotion_use_upper = 1

map f <Plug>(easymotion-fl)
map t <Plug>(easymotion-tl)
map F <Plug>(easymotion-Fl)
map T <Plug>(easymotion-Tl)

" :h easymotion-command-line
nmap g/ <Plug>(easymotion-sn)
xmap g/ <Plug>(easymotion-sn)
omap g/ <Plug>(easymotion-tn)

" Jump to first match with enter & space
let g:EasyMotion_enter_jump_first = 1
let g:EasyMotion_space_jump_first = 1

nmap <Space>s <Plug>(easymotion-s2)
xmap <Space>s <Plug>(easymotion-s2)
" surround.vimと被らないように
omap z <Plug>(easymotion-s2)

"<<<Plugin>>> tweetvim {{{1
nnoremap <silent> <Leader>t  :TweetVimListStatuses list<CR>

"<<<Plugin>>> expand-region {{{1
vmap v <Plug>(expand_region_expand)
vmap <C-v> <Plug>(expand_region_shrink)

"<<<Plugin>>> Gtags {{{1
nnoremap <C-g> :Gtags 
nnoremap <C-h> :Gtags -f %<CR>
nnoremap <C-j> :GtagsCursor<CR>
nnoremap <C-n> :cn<CR>
nnoremap <C-p> :cp<CR>

"<<<Plugin>>> unite-everything {{{1
if has('win32') || has('win64')
    let g:unite_source_everything_limit = 100
    let g:unite_source_everything_full_path_search = 0
    let g:unite_source_everything_posix_regexp_search = 0
    let g:unite_source_everything_sort_by_full_path = 0
    let g:unite_source_everything_case_sensitive_search = 0
    let g:unite_source_everything_cmd_path = 'es.exe'
    let g:unite_source_everything_async_minimum_length = 3
endif

