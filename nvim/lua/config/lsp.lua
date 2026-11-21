-- LSP。サーバの設定は nvim-lspconfig の lsp/*.lua を使い、標準の vim.lsp.enable で有効にする。
-- サーバは mason では入れない（brew / npm で入れる）。入っていないサーバは黙って飛ばす。
local servers = {
  "bashls",
  "biome",
  "docker_compose_language_service",
  "dockerls",
  "gopls",
  "intelephense",
  "jsonls",
  "lua_ls",
  "marksman",
  "pyright",
  "ruff",
  "rust_analyzer",
  "tailwindcss",
  "taplo",
  "terraformls",
  "vtsls",
  "vue_ls",
  "yamlls",
}

-- JSON / YAML: SchemaStore のスキーマで検証・補完する
vim.lsp.config("jsonls", {
  settings = {
    json = {
      schemas = require("schemastore").json.schemas(),
      validate = { enable = true },
    },
  },
})
vim.lsp.config("yamlls", {
  settings = {
    yaml = {
      schemaStore = { enable = false, url = "" },
      schemas = require("schemastore").yaml.schemas(),
      keyOrdering = false,
    },
  },
})

-- Lua: Neovim の設定を編集するときだけ Neovim の API を読み込ませる（lazydev の代わり）
vim.lsp.config("lua_ls", {
  on_init = function(client)
    local root = client.workspace_folders and client.workspace_folders[1] and client.workspace_folders[1].name
    if not root or vim.uv.fs_realpath(root) ~= vim.uv.fs_realpath(vim.fn.stdpath("config")) then
      return
    end
    client.config.settings.Lua = vim.tbl_deep_extend("force", client.config.settings.Lua or {}, {
      runtime = { version = "LuaJIT", path = { "lua/?.lua", "lua/?/init.lua" } },
      workspace = { checkThirdParty = false, library = { vim.env.VIMRUNTIME } },
    })
  end,
  settings = { Lua = { workspace = { checkThirdParty = false }, completion = { callSnippet = "Replace" } } },
})

-- Vue: vtsls に @vue/typescript-plugin を渡す（vue-language-server が入っているときだけ）
local vue_bin = vim.fn.exepath("vue-language-server")
if vue_bin ~= "" then
  local real = vim.uv.fs_realpath(vue_bin) or vue_bin
  local vue_pkg = vim.fs.root(real, "package.json")
  if not vue_pkg then
    -- devbox（nix）のものは bin が包みのスクリプトなので、中に書かれた本体の場所から探す
    local f = io.open(real, "r")
    local text = f and f:read(4096) or ""
    if f then
      f:close()
    end
    local js = text:match("(/[^%s'\"]+/bin/vue%-language%-server%.js)")
    vue_pkg = js and vim.fs.root(js, "package.json")
  end
  if vue_pkg then
    vim.lsp.config("vtsls", {
      filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact", "vue" },
      settings = {
        vtsls = {
          tsserver = {
            globalPlugins = {
              {
                name = "@vue/typescript-plugin",
                location = vue_pkg,
                languages = { "vue" },
                configNamespace = "typescript",
              },
            },
          },
        },
      },
    })
  end
end

-- cmd が関数のサーバは、実行ファイルの名前をここで決めて有無を確かめる。
-- biome はプロジェクトの node_modules/.bin のものも使うので、biome.json のあるところだけで動くのに任せて常に有効にする。
local exe_of = {
  biome = true,
  jsonls = "vscode-json-language-server",
  tailwindcss = "tailwindcss-language-server",
  yamlls = "yaml-language-server",
}
local enabled = {}
for _, name in ipairs(servers) do
  local cfg = vim.lsp.config[name]
  local cmd = cfg and cfg.cmd
  local exe = exe_of[name]
  if exe == nil and type(cmd) == "table" then
    exe = cmd[1]
  end
  if exe == true or (type(exe) == "string" and vim.fn.executable(exe) == 1) then
    enabled[#enabled + 1] = name
  end
end
vim.lsp.enable(enabled)

-- LSP がつながったバッファでのキーと補完 -------------------------------------------
vim.api.nvim_create_autocmd("LspAttach", {
  group = vim.api.nvim_create_augroup("my_lsp_attach", { clear = true }),
  callback = function(ev)
    local client = vim.lsp.get_client_by_id(ev.data.client_id)
    if not client then
      return
    end
    local buf = ev.buf

    -- 標準の補完（打つと候補が出る）。blink.cmp の代わり
    if client:supports_method("textDocument/completion") then
      vim.lsp.completion.enable(true, client.id, buf, { autotrigger = true })
    end
    -- 型などの補足表示（inlay hints）は LazyVim と同じく最初から出す（vue は除く）
    if client:supports_method("textDocument/inlayHint") and vim.bo[buf].filetype ~= "vue" then
      vim.lsp.inlay_hint.enable(true, { bufnr = buf })
    end

    local function map(mode, lhs, rhs, desc, opts)
      vim.keymap.set(mode, lhs, rhs, vim.tbl_extend("force", { buffer = buf, desc = desc }, opts or {}))
    end
    map("n", "gd", "<cmd>FzfLua lsp_definitions jump1=true ignore_current_line=true<cr>", "Goto Definition")
    map("n", "gr", "<cmd>FzfLua lsp_references jump1=true ignore_current_line=true<cr>", "References", { nowait = true })
    map("n", "gI", "<cmd>FzfLua lsp_implementations jump1=true ignore_current_line=true<cr>", "Goto Implementation")
    map("n", "gy", "<cmd>FzfLua lsp_typedefs jump1=true ignore_current_line=true<cr>", "Goto T[y]pe Definition")
    map("n", "gD", vim.lsp.buf.declaration, "Goto Declaration")
    map("n", "K", function() vim.lsp.buf.hover({ border = "rounded" }) end, "Hover")
    map("n", "gK", function() vim.lsp.buf.signature_help({ border = "rounded" }) end, "Signature Help")
    map("i", "<c-k>", function() vim.lsp.buf.signature_help({ border = "rounded" }) end, "Signature Help")
    map({ "n", "x" }, "<leader>ca", vim.lsp.buf.code_action, "Code Action")
    map("n", "<leader>cA", function()
      vim.lsp.buf.code_action({ context = { only = { "source" }, diagnostics = {} } })
    end, "Source Action")
    map("n", "<leader>cr", vim.lsp.buf.rename, "Rename")
    map({ "n", "x" }, "<leader>cc", vim.lsp.codelens.run, "Run Codelens")
    map("n", "<leader>cl", "<cmd>checkhealth vim.lsp<cr>", "Lsp Info")
    map("n", "<leader>ss", "<cmd>FzfLua lsp_document_symbols<cr>", "LSP Symbols")
    map("n", "<leader>sS", "<cmd>FzfLua lsp_live_workspace_symbols<cr>", "LSP Workspace Symbols")
    map("n", "<leader>cs", "<cmd>FzfLua lsp_document_symbols<cr>", "Symbols")
    if vim.lsp.inlay_hint then
      map("n", "<leader>uh", function()
        vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled({ bufnr = buf }), { bufnr = buf })
      end, "Toggle Inlay Hints")
    end
  end,
})
