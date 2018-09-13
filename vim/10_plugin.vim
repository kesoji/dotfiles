" vim: foldmethod=marker foldcolumn=3 foldlevel=0 fenc=utf-8

" Plugin Manager Settings {{{1
let g:vimproc#download_windows_dll = 1
call plug#begin('~/.vim/plugged')
Plug 'tpope/vim-unimpaired'
Plug 'tpope/vim-fugitive'
Plug 'w0rp/ale'
Plug 'Shougo/vimproc.vim', { 'do': 'make' }
Plug 'Shougo/neomru.vim'
Plug 'lambdalisue/gina.vim'
Plug 'scrooloose/nerdcommenter'
Plug 'majutsushi/tagbar'
"Plug 'gregsexton/MatchTag'
Plug 'xolox/vim-session'
Plug 'xolox/vim-misc'
Plug 'godlygeek/tabular'
Plug 'itchyny/lightline.vim'
Plug 'iamcco/markdown-preview.vim'
Plug 'Townk/vim-autoclose'
Plug 'tyru/restart.vim'
Plug 'vim-scripts/cisco.vim'
Plug 'posva/vim-vue'
Plug 'bbchung/gtags.vim'
Plug 'scrooloose/syntastic'
Plug 'Yggdroot/indentLine'
Plug 'easymotion/vim-easymotion'
Plug 'basyura/twibill.vim'
Plug 'terryma/vim-expand-region'
Plug 'Konfekt/FastFold'
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
Plug 'SirVer/ultisnips'
Plug 'honza/vim-snippets'
Plug 'mhinz/vim-signify'
Plug 'Valloric/YouCompleteMe', { 'do': './install.py --go-completer' }
Plug 'Shougo/vinarise'
Plug 'machakann/vim-sandwich'
Plug 'kana/vim-operator-user'
Plug 'kana/vim-textobj-user'
Plug 'kana/vim-operator-replace'
Plug 'kana/vim-textobj-indent'
Plug 'haya14busa/vim-edgemotion'
Plug 'haya14busa/vim-operator-flashy'
Plug 'AndrewRadev/splitjoin.vim'
Plug 'bps/vim-textobj-python'
Plug 'prabirshrestha/async.vim'
Plug 'prabirshrestha/vim-lsp'
Plug 'prabirshrestha/asyncomplete.vim'
Plug 'prabirshrestha/asyncomplete-lsp.vim'
Plug 'leafgarland/typescript-vim'
if has('mac')
    " Mac: fzf shoud be installed by Homebrew
    Plug '/usr/local/opt/fzf'
    Plug 'junegunn/fzf'
    Plug 'junegunn/fzf.vim'
elseif !has('win32') && !has('win64')
    " Linux
    Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
    Plug 'junegunn/fzf.vim'
else
    " Windows
endif
Plug 'PProvost/vim-ps1', { 'for': ['ps1'] }
Plug 'Rykka/clickable.vim', { 'for': ['rst'] }
Plug 'Rykka/riv.vim', { 'for': ['rst'] }
Plug 'c9s/phpunit.vim', {'for': ['php']}
Plug 'tbastos/vim-lua', { 'for': ['lua'] }
Plug 'xolox/vim-lua-ftplugin', { 'for': ['lua'] }
Plug 'elzr/vim-json', { 'for': ['javascript', 'json'] }
Plug 'fatih/vim-go', { 'for': ['go'], 'do': ':GoInstallBinaries' }
Plug 'plasticboy/vim-markdown', { 'for': ['markdown'] }
Plug 'mattn/emmet-vim', { 'for': ['html', 'css'] }
Plug 'hotchpotch/perldoc-vim', { 'for': ['perl'] }
Plug 'petdance/vim-perl', { 'for': ['perl'] }
Plug 'c9s/perlomni.vim', { 'for': ['perl'] }
Plug 'cespare/vim-toml', { 'for': ['toml'] }
Plug 'davidhalter/jedi-vim', { 'for': ['python'] }
"Plug 'lambdalisue/vim-pyenv', { 'for': ['python'] }
Plug 'myhere/vim-nodejs-complete', { 'for': ['javascript'] }
Plug 'mattn/jscomplete-vim', { 'for': ['javascript'] }
" Clolor Scheme
Plug 'tomasr/molokai'
Plug 'sjl/badwolf'
Plug 'nanotech/jellybeans.vim'
Plug 'w0ng/vim-hybrid'
Plug 'altercation/vim-colors-solarized'
Plug 'morhetz/gruvbox'
Plug 'cocopon/iceberg.vim'

call plug#end()

"<<<Plugin>>> vim-sandwitch {{{1
runtime macros/sandwich/keymap/surround.vim

"<<<Plugin>>> IndentLine {{{1
if exists('g:indentLine_loaded')
    noremap <silent> <F4> :IndentLinesToggle<CR>
endif
let g:indentLine_faster = 1

"<<<Plugin>>> Operator-flashy {{{1
if exists('g:operator#flashy#flash_time')
    map  y <Plug>(operator-flashy)
    nmap Y <Plug>(operator-flashy)$
else
    nnoremap Y y$
endif

"<<<Plugin>>> fzf {{{1
nnoremap : :<C-u>Buffers<CR>
nmap <Space>f [fzf]
nnoremap [fzf]m :<C-u>History<CR>
nnoremap [fzf]f :<C-u>Files<CR>
nnoremap [fzf]t :<C-u>Tags<CR>

command! -bang -nargs=* Rg
  \ call fzf#vim#grep(
  \   'rg --column --line-number --no-heading --color=always '.shellescape(<q-args>), 1,
  \   <bang>0 ? fzf#vim#with_preview('up:60%')
  \           : fzf#vim#with_preview('right:50%:hidden', '?'),
  \   <bang>0)
nnoremap <expr> g* ':Rg ' . expand('<cword>') . '<CR>'

"<<<Plugin>>> jedi-vim {{{1
let g:jedi#auto_initialization = 1
let g:jedi#rename_command = "<leader>R"
let g:jedi#popup_on_dot = 1

"<<<Plugin>>> quickrun {{{1
"[quickrun.vim について語る - C++でゲームプログラミング](http://d.hatena.ne.jp/osyo-manga/20130311/1363012363)
let g:quickrun_config = {
            \   "_" : {
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

inoremap \\r <ESC>:QuickRun<CR>
" <C-c> で実行を強制終了させる
" quickrun.vim が実行していない場合には <C-c> を呼び出す
nnoremap <expr><silent> <C-c> quickrun#is_running() ? quickrun#sweep_sessions() : "\<C-c>"

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
map <space>ob <Plug>(openbrowser-smart-search)

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


"<<<Plugin>>> expand-region {{{1
vmap v <Plug>(expand_region_expand)
vmap <C-v> <Plug>(expand_region_shrink)

"<<<Plugin>>> Gtags {{{1
nnoremap <C-g> :Gtags -g 
nnoremap <C-h> :Gtags -f %<CR>
nnoremap <C-j> :GtagsCursor<CR>
nnoremap <C-k> :Gtags -r <C-r><C-w><CR>

"<<<Plugin>>> memolist {{{1
let g:memolist_path = "~/.vim/memo"

"<<<Plugin>>> vim-go {{{1
augroup VimGoMySettings
    autocmd!
    autocmd FileType go nmap <leader>u <Plug>(go-run)
    autocmd FileType go nmap <leader>t <Plug>(go-test)
    autocmd FileType go nmap <leader>f <Plug>(go-test-func)
    autocmd FileType go nmap <leader>c <Plug>(go-coverage-toggle)
    autocmd FileType go nmap <leader>m <Plug>(go-metalinter)
    autocmd FileType go nnoremap <C-h> :<C-u>GoDeclsDir<cr>
    autocmd FileType go inoremap <C-h> <esc>:<C-u>GoDeclsDir<cr>
    autocmd FileType go nnoremap <leader>b :<C-u>call <SID>build_go_files()<CR>
    autocmd Filetype go command! -bang A call go#alternate#Switch(<bang>0, 'edit')
    autocmd Filetype go command! -bang AV call go#alternate#Switch(<bang>0, 'vsplit')
    autocmd Filetype go command! -bang AS call go#alternate#Switch(<bang>0, 'split')
augroup END
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
let g:go_metalinter_autosave = 1
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


"<<<Plugin>>> vim-edgemotion {{{1
map ej <Plug>(edgemotion-j)
map ek <Plug>(edgemotion-k)

"<<<Plugin>>> vim-lsp {{{1
" Python {{{2
if executable('pyls')
    " pip install python-language-server
    augroup LspPython
        au!
        autocmd User lsp_setup call lsp#register_server({
                    \ 'name': 'pyls',
                    \ 'cmd': {server_info->['pyls']},
                    \ 'whitelist': ['python'],
                    \ })
        autocmd FileType python setlocal omnifunc=lsp#complete
    augroup END
endif

"<<<Plugin>>> NerdCommenter {{{1
nmap <C-_> <Plug>NERDCommenterToggle
vmap <C-_> <Plug>NERDCommenterToggle
imap <C-_> <ESC>$a<Space><Plug>NERDCommenterInsert

"<<<Plugin>>> UltiSnips {{{1
let g:UltiSnipsExpandTrigger       = "<tab>"
let g:UltiSnipsJumpForwardTrigger  = "<tab>"
let g:UltiSnipsJumpBackwardTrigger = "<c-z>"

"<<<Plugin>>> YouCompleteMe {{{1
let g:ycm_key_list_select_completion = ['<Down>']
let g:ycm_key_list_previous_completion = ['<Up>']

"<<<Plugin>>> Tagbar {{{1
nnoremap <silent> <leader>t :TagbarToggle<CR>

"<<<Plugin>>> phpunit {{{1
let g:phpunit_bin = './vendor/bin/phpunit'

"<<<Plugin>>> ale {{{1
let g:ale_completion_enabled = 1
let g:ale_sign_column_always = 1
