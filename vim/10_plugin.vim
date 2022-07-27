" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8
"
if empty(glob('~/.vim/autoload/plug.vim'))
  if !executable("curl")
    echoerr "You have to install curl or first install vim-plug yourself!"
    "execute 'q!'
  endif
  echo "Installing Vim-Plug..."
  echo ""
  if has("win64")
    silent exec "!curl -fLo " . expand('~/vimfiles/autoload/plug.vim') . " --create-dirs https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim"
  else
    silent !curl -fLo ~/.vim/autoload/plug.vim --create-dirs https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
  endif
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

" Plugin Manager Settings {{{1
let g:vimproc#download_windows_dll = 1
call plug#begin('~/.vim/plugged')
Plug 'mg979/vim-visual-multi'
Plug 'cocopon/vaffle.vim'
Plug 'lighttiger2505/sqls.vim'
Plug 'andymass/vim-matchup'
Plug 'mattn/vim-starwars'
"Plug 'w0rp/ale'
"Plug 'honza/vim-snippets'
Plug 'SirVer/ultisnips'
Plug 'qpkorr/vim-renamer'
Plug 'tpope/vim-unimpaired'
Plug 'tpope/vim-repeat'
Plug 'tpope/vim-fugitive'
Plug 'tpope/vim-rhubarb'
Plug 'Shougo/vimproc.vim', { 'do': 'make' }
Plug 'christoomey/vim-tmux-navigator'
Plug 'scrooloose/nerdcommenter'
Plug 'scrooloose/nerdtree'
Plug 'mechatroner/rainbow_csv'

"Plug 'majutsushi/tagbar'
" Replacement for tagbar
Plug 'liuchengxu/vista.vim'
Plug 'gregsexton/MatchTag'
Plug 'xolox/vim-session'
Plug 'xolox/vim-misc'
Plug 'godlygeek/tabular'
Plug 'itchyny/lightline.vim'
Plug 'iamcco/markdown-preview.vim'
Plug 'mileszs/ack.vim'
Plug 'thinca/vim-qfreplace'
Plug 'jiangmiao/auto-pairs'
Plug 'alvan/vim-closetag'
"Plug 'Townk/vim-autoclose'
"Plug 'vim-scripts/cisco.vim'
Plug 'vim-syntastic/syntastic'
Plug 'Yggdroot/indentLine'
Plug 'easymotion/vim-easymotion'
Plug 'terryma/vim-expand-region'
"Plug 'Konfekt/FastFold'
Plug 'nathanaelkane/vim-indent-guides'
Plug 'janko-m/vim-test'
Plug 'thinca/vim-quickrun'
Plug 'thinca/vim-visualstar'
Plug 'thinca/vim-fontzoom'
Plug 'thinca/vim-qfreplace'
Plug 'rking/ag.vim'
Plug 'vim-scripts/open-browser.vim'
Plug 'vim-scripts/AnsiEsc.vim'
Plug 'vim-scripts/DirDiff.vim'
Plug 'glidenote/memolist.vim'
Plug 'mhinz/vim-signify'
"Plug 'Valloric/YouCompleteMe', { 'do': './install.py --go-completer --ts-completer' }
"Plug 'Valloric/YouCompleteMe', { 'do': 'zsh -i -c \"nvminit && ./install.py --go-completer --ts-completer\"' }
Plug 'Shougo/vinarise'

Plug 'machakann/vim-sandwich'
Plug 'kana/vim-textobj-user'
"Plug 'kana/vim-operator-replace'
"Plug 'kana/vim-textobj-indent'
Plug 'haya14busa/vim-edgemotion'
Plug 'kana/vim-operator-user'
Plug 'haya14busa/vim-operator-flashy'
Plug 'AndrewRadev/splitjoin.vim'
Plug 'chr4/nginx.vim'
Plug 'thinca/vim-ref'
Plug 'joonty/vdebug', { 'on': 'VdebugEnable' }
Plug 'simeji/winresizer'
Plug 'prabirshrestha/async.vim'
Plug 'prabirshrestha/asyncomplete.vim'
Plug 'prabirshrestha/asyncomplete-lsp.vim'
Plug 'prabirshrestha/asyncomplete-ultisnips.vim'
Plug 'prabirshrestha/vim-lsp'
Plug 'mattn/vim-lsp-settings'
" don't forget to install goimports itself
Plug 'mattn/vim-goimports'
Plug 'fatih/vim-go', { 'do': ':GoUpdateBinaries' }
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
Plug 'junegunn/fzf.vim'
Plug 'posva/vim-vue'
Plug 'bps/vim-textobj-python'
Plug 'leafgarland/typescript-vim'
Plug 'hashivim/vim-terraform'
Plug 'juliosueiras/vim-terraform-completion'
Plug 'pearofducks/ansible-vim'
Plug 'PProvost/vim-ps1',           { 'for': ['ps1'] }
Plug 'Rykka/clickable.vim',        { 'for': ['rst'] }
Plug 'Rykka/riv.vim',              { 'for': ['rst'] }
Plug 'vim-ruby/vim-ruby',          { 'for': ['ruby', 'eruby'] }
Plug 'tpope/vim-endwise'
Plug 'tpope/vim-rails',            { 'for': ['ruby', 'eruby'] }
Plug 'tbastos/vim-lua',            { 'for': ['lua'] }
Plug 'xolox/vim-lua-ftplugin',     { 'for': ['lua'] }
Plug 'plasticboy/vim-markdown',    { 'for': ['markdown'] }
Plug 'othree/html5.vim',           { 'for': ['html'] }
Plug 'mattn/emmet-vim',            { 'for': ['html', 'css', 'blade'] }
Plug 'hotchpotch/perldoc-vim',     { 'for': ['perl'] }
Plug 'petdance/vim-perl',          { 'for': ['perl'] }
Plug 'c9s/perlomni.vim',           { 'for': ['perl'] }
Plug 'cespare/vim-toml',           { 'for': ['toml'] }
"Plug 'othree/yajs',                { 'for': ['javascript'] }
Plug 'elzr/vim-json',              { 'for': ['javascript', 'json'] }
Plug 'mattn/jscomplete-vim',       { 'for': ['javascript'] }
" Clolor Scheme
Plug 'tomasr/molokai'
Plug 'sjl/badwolf'
Plug 'nanotech/jellybeans.vim'
Plug 'w0ng/vim-hybrid'
Plug 'altercation/vim-colors-solarized'
Plug 'morhetz/gruvbox'
Plug 'cocopon/iceberg.vim'

call plug#end()

function! s:is_plugged(name)
    if exists('g:plugs') && has_key(g:plugs, a:name) && isdirectory(g:plugs[a:name].dir)
        return 1
    else
        return 0
    endif
endfunction

"if has('clientserver')
"    call singleton#enable()
"    let g:singleton#opener = "edit"
"endif
"

"<<<Plugin>>> vista {{{1
nnoremap VV :<c-u>Vista!!<CR>
let g:vista_default_executive = 'vim_lsp'

"<<<Plugin>>> vim-lsp {{{1
"https://mattn.kaoriya.net/software/vim/20191231213507.htm
if empty(globpath(&rtp, 'autoload/lsp.vim'))
  finish
endif

function! s:on_lsp_buffer_enabled() abort
  setlocal omnifunc=lsp#complete
  setlocal signcolumn=yes
  nmap <buffer> gd <plug>(lsp-definition)
  nmap <buffer> <C-]> <plug>(lsp-definition)
  nmap <buffer> gr <plug>(lsp-references)
  nmap <buffer> gt <plug>(lsp-type-definition)
  nmap <buffer> gi <plug>(lsp-implementation)
  nmap <buffer> <f2> <plug>(lsp-rename)
  nmap <buffer> <S-k> <plug>(lsp-hover)
  inoremap <expr> <cr> pumvisible() ? "\<c-y>\<cr>" : "\<cr>"
endfunction

augroup lsp_install
  au!
  autocmd User lsp_buffer_enabled call s:on_lsp_buffer_enabled()
augroup END
command! LspDebug let lsp_log_verbose=1 | let lsp_log_file = expand('~/lsp.log')

let g:lsp_diagnostics_enabled = 1
let g:lsp_diagnostics_echo_cursor = 1
let g:asyncomplete_auto_popup = 1
"let g:asyncomplete_auto_completeopt = 0
let g:asyncomplete_popup_delay = 200
let g:lsp_text_edit_enabled = 1
let g:lsp_preview_float = 1
let g:lsp_diagnostics_float_cursor = 1
"let g:lsp_async_completion = 1

let g:lsp_settings_filetype_go = ['gopls', 'golangci-lint-langserver']

"<<<Plugin>>> vim-go {{{1
function! s:build_go_files()
    let l:file = expand('%')
    if l:file =~# '^\f\+_test\.go$'
        call go#test#Test(0, 1)
    elseif l:file =~# '^\f\+\.go$'
        call go#cmd#Build(0)
    endif
endfunction
let g:go_fmt_command = "goimports"
let g:go_fmt_autosave = 1
let g:go_metalinter_command = "golangci-lint"
let g:go_metalinter_autosave = 0
let g:go_auto_type_info = 1
let g:go_auto_sameids = 1

let g:go_highlight_functions = 1
let g:go_highlight_function_calls = 1
let g:go_highlight_methods = 1
let g:go_highlight_structs = 1
let g:go_highlight_array_whitespace_error = 0
let g:go_highlight_chan_whitespace_error = 0
let g:go_highlight_extra_types = 0
let g:go_highlight_space_tab_error = 0
let g:go_highlight_trailing_whitespace_error = 0
let g:go_highlight_operators = 0
let g:go_highlight_function_arguments = 0
let g:go_highlight_types = 0
let g:go_highlight_fields = 0
let g:go_highlight_build_constraints = 0
let g:go_highlight_generate_tags = 0
let g:go_highlight_string_spellcheck = 1
let g:go_highlight_format_strings = 1
let g:go_highlight_variable_declarations = 0
let g:go_highlight_variable_assignments = 0

"<<<Plugin>>> vaffle {{{1
nnoremap FJ :Vaffle<CR>

"<<<Plugin>>> vim-sandwich {{{1
runtime macros/sandwich/keymap/surround.vim

"<<<Plugin>>> IndentLine {{{1
if exists('g:indentLine_loaded')
    noremap <silent> <F4> :IndentLinesToggle<CR>
endif
let g:indentLine_faster = 1

"<<<Plugin>>> Operator-flashy {{{1
if s:is_plugged("vim-operator-flashy")
    map  y <Plug>(operator-flashy)
    nmap Y <Plug>(operator-flashy)$
else
    nnoremap Y y$
endif

"<<<Plugin>>> fzf {{{1
nmap <Space>f [fzf]
nnoremap [fzf]b :<C-u>Buffers<CR>
nnoremap [fzf]m :<C-u>History<CR>
nnoremap [fzf]f :<C-u>Files<CR>
if s:is_plugged("vista.vim")
    nnoremap [fzf]t :<C-u>Vista finder<CR>
endif

command! -bang -nargs=* Gr
      \ call fzf#vim#grep(
      \   'rg --column --line-number --no-heading --color=always '.shellescape(<q-args>), 1,
      \   <bang>0 ? fzf#vim#with_preview('up:60%')
      \           : fzf#vim#with_preview('right:50%:hidden', '?'),
      \   <bang>0)
command! -bang -nargs=* Gri
      \ call fzf#vim#grep(
      \   'rg -i --column --line-number --no-heading --color=always '.shellescape(<q-args>), 1,
      \   <bang>0 ? fzf#vim#with_preview('up:60%')
      \           : fzf#vim#with_preview('right:50%:hidden', '?'),
      \   <bang>0)
nnoremap <expr> g* ':Gr ' . expand('<cword>') . '<CR>'

command! -nargs=0 Ghq
      \ call fzf#run({
      \   'source': 'ghq list --full-path',
      \   'sink': 'cd'
      \ })


"<<<Plugin>>> quickrun {{{1
"[quickrun.vim について語る - C++でゲームプログラミング](http://d.hatena.ne.jp/osyo-manga/20130311/1363012363)
let g:quickrun_config = {
            \   "_" : {
            \       "runner" : "vimproc",
            \       "runner/vimproc/updatetime" : 50,
            \       "outputter/buffer/split" : ":rightbelow vertical",
            \       "outputter/buffer/close_on_empty" : 1,
            \       "outputter" : "error",
            \       "outputter/error/success" : "buffer",
            \       "outputter/error/error" : "quickfix",
            \       "hook/output_encode/encoding" : "utf-8",
            \   },
            \   "python": {
            \       "hook/output_encode/encoding" : "utf-8",
            \   },
            \}

nnoremap <Leader>r :QuickRun<CR>
inoremap \\r <ESC>:QuickRun<CR>
" <C-c> で実行を強制終了させる
" quickrun.vim が実行していない場合には <C-c> を呼び出す
nnoremap <expr><silent> <C-c> quickrun#is_running() ? quickrun#sweep_sessions() : "\<C-c>"

" Markdown {{{1

"<<<Plugin>>> Vim-Markdown [plasticboy/vim-markdown](https://github.com/plasticboy/vim-markdown){{{2
let g:vim_markdown_folding_disabled = 1
"let g:vim_markdown_folding_level = 2
"let g:vim_markdown_emphasis_multiline = 0
let g:vim_markdown_conceal = 0

"<<<Plugin>>> previm {{{2
augroup PrevimSettings
    autocmd!
    autocmd BufNewFile,BufRead *.{md,mdwn,mkd,mkdn,mark*} set filetype=markdown
augroup END

let g:previm_enable_realtime = 1

"<<<Plugin>>> OpenBrowser {{{1
let g:netrw_nogx = 1 " disable netrw's gx mapping.
map <space>ob <Plug>(openbrowser-smart-search)

"<<<Plugin>>> lightline {{{1
set laststatus=2
set noshowmode

let g:lightline = {
      \ 'colorscheme': 'wombat',
      \ 'component_function': {
      \   'filename': 'LightLineFileNameWithParentDir'
      \ }
      \ }

function! LightLineFileNameWithParentDir()
    if expand('%:t') ==# ''
        let filename = '[No Name]'
    else
        let dirfiles = split(expand('%:p'), '/')
        if len(dirfiles) < 2
            let filename = dirfiles[0]
        else
            let filename = dirfiles[-2] . '/' . dirfiles[-1]
        endif
    endif
    return filename
endfunction

"<<<Plugin>>> vim-session {{{1

if s:is_plugged("vim-session")
    command! -nargs=* -complete=command OS OpenSession
    command! -nargs=* -complete=command SS SaveSession

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
endif

"<<<Plugin>>> vim-json {{{1
let g:vim_json_syntax_conceal = 0

""<<<Plugin>>> syntastic {{{1
"set statusline+=%#warningmsg#
"set statusline+=%{SyntasticStatuslineFlag()}
"set statusline+=%*
"let g:syntastic_always_populate_loc_list = 1
"let g:syntastic_auto_loc_list = 1
"let g:syntastic_loc_list_height = 6
"let g:syntastic_check_on_open = 1
"let g:syntastic_check_on_wq = 0
"
"let g:syntastic_enable_perl_checker = 1
"let g:syntastic_perl_checkers = ['perl', 'podchecker']
"let g:syntastic_javascript_checkers = ['eslint']

"<<<Plugin>>> vim-easymotion {{{1
let g:EasyMotion_do_mapping = 0
let g:EasyMotion_keys = ';HKLYUIOPNM,QWERTASDGZXCVBJF'
" Show target key with upper case to improve readability
let g:EasyMotion_use_upper = 1
let g:EasyMotion_smartcase = 1
" Jump to first match with enter & space
let g:EasyMotion_enter_jump_first = 1
let g:EasyMotion_space_jump_first = 1

"map f <Plug>(easymotion-fl)
"map t <Plug>(easymotion-tl)
"map F <Plug>(easymotion-Fl)
"map T <Plug>(easymotion-Tl)
map <Leader>j <Plug>(easymotion-j)
map <Leader>k <Plug>(easymotion-k)

" :h easymotion-command-line
nmap g/ <Plug>(easymotion-sn)
xmap g/ <Plug>(easymotion-sn)
omap g/ <Plug>(easymotion-tn)

nmap <Space>s <Plug>(easymotion-s2)
xmap <Space>s <Plug>(easymotion-s2)
" surround.vimと被らないように
omap z <Plug>(easymotion-s2)

"<<<Plugin>>> vim-edgemotion {{{1
map _ <Plug>(edgemotion-j)
map ^ <Plug>(edgemotion-k)


"<<<Plugin>>> expand-region {{{1
vmap v <Plug>(expand_region_expand)
vmap <C-v> <Plug>(expand_region_shrink)


"<<<Plugin>>> memolist {{{1
let g:memolist_path = "~/.vim/memo"


"<<<Plugin>>> NERDCommenter {{{1
nmap <C-_> <Plug>NERDCommenterToggle
vmap <C-_> <Plug>NERDCommenterToggle
imap <C-_> <ESC>$a<Space><Plug>NERDCommenterInsert

"<<<Plugin>>> NERDTree {{{1
map <C-e> :NERDTreeToggle<CR>
imap <C-e> <ESC><C-u>:NERDTreeToggle<CR>

"<<<Plugin>>> UltiSnips {{{1
let g:UltiSnipsJumpForwardTrigger = "<c-f>"
let g:UltiSnipsJumpBackwardTrigger = "<c-b>"

"let g:UltiSnipsExpandTrigger="<c-e>"
call asyncomplete#register_source(asyncomplete#sources#ultisnips#get_source_options({
    \ 'name': 'ultisnips',
    \ 'allowlist': ['*'],
    \ 'completor': function('asyncomplete#sources#ultisnips#completor'),
    \ }))

"<<<Plugin>>> YouCompleteMe {{{1
let g:ycm_key_list_select_completion = ['<Down>']
let g:ycm_key_list_previous_completion = ['<Up>']


"<<<Plugin>>> Tagbar {{{1
"nnoremap <silent> <leader><leader>e :TagbarToggle<CR>


"<<<Plugin>>> ale {{{1
let g:ale_linters = {
            \ 'php': ['langserver', 'phpstan', 'phpcs', 'php'],
            \ 'ruby': ['rubocop'],
            \}
let g:ale_fixers = {
            \ '*': ['remove_trailing_lines', 'trim_whitespace'],
            \ 'php': ['phpcbf'],
            \ 'ruby': ['rubocop'],
            \ 'javascript': ['prettier', 'eslint'],
            \ 'autohotkey': [],
            \}
let g:ale_open_list = 1
let g:ale_fix_on_save = 1
let g:ale_lint_on_text_changed = 'never'
let g:ale_lint_on_enter = 0
let g:ale_completion_enabled = 0
let g:ale_sign_column_always = 1
let g:ale_php_phpcs_standard = 'PSR2'
let g:ale_php_phpcs_options = '--exclude=Generic.Files.LineLength.TooLong'
let g:ale_php_phpcbf_standard = 'PSR2'
let g:ale_php_langserver_use_global = 1
let g:ale_php_langserver_executable = $HOME.'/.config/composer/vendor/bin/php-language-server.php'
let g:ale_javascript_prettier_use_local_config = 1

nmap <C-a><C-f> <Plug>(ale_fix)
nmap <leader>n <Plug>(ale_toggle)

"<<<plugin>>> vim-vue {{{1
autocmd FileType vue syntax sync fromstart

"<<<plugin>>> vim-terraform {{{1
let g:terraform_fmt_on_save = 1

"<<<plugin>>> vim-ref {{{1
let g:ref_phpmanual_path = $HOME . '/.vim/refs/php-chunked-xhtml'

command! -nargs=0 RefPhpManualUpdate call RefPhpManualUpdate()
function! RefPhpManualUpdate()
    !mkdir ~/.vim/refs; wget http://jp2.php.net/get/php_manual_ja.tar.gz/from/this/mirror -O ~/.vim/refs/dl.tgz; tar zxf ~/.vim/refs/dl.tgz -C ~/.vim/refs ; rm -f ~/.vim/refs/dl.tgz
endfunction

"<<<plugin>>> vim-tmux-navigator
let g:tmux_navigator_no_mappings = 1
"{xxx-Mapping}を指定する
"nnoremap <silent> {Left-Mapping} :TmuxNavigateLeft<cr>
"nnoremap <silent> {Down-Mapping} :TmuxNavigateDown<cr>
"nnoremap <silent> {Up-Mapping} :TmuxNavigateUp<cr>
"nnoremap <silent> {Right-Mapping} :TmuxNavigateRight<cr>
"nnoremap <silent> {Previous-Mapping} :TmuxNavigatePrevious<cr>
"
"<<<plugin>>> vim-jsx-pretty
let g:vim_jsx_pretty_colorful_config = 1

"<<<plugin>>> vim-closetag
"let g:closetag_filenames = '*.html,*.xhtml,*.phtml,'
"let g:closetag_xhtml_filenames = '*.xhtml,*.jsx,*.js'
let g:closetag_filetypes = 'html,xhtml,phtml,javascript'
let g:closetag_xhtml_filetypes = 'xhtml,jsx,javascript'

"<<<plugin>>> winresizer {{{1
let g:winresizer_start_key = '<C-x>'

"<<<plugin>>> vim-js-importer {{{1
nnoremap <Leader><Leader>j :ImportJSWord<CR>
nnoremap <Leader><Leader>i :ImportJSFix<CR>
nnoremap <Leader><Leader>g :ImportJSGoto<CR>


"<<<plugin>>> asyncomplete {{{1
" see readme of asyncomplete
set shortmess+=c
