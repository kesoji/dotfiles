local function has_biome_config(ctx)
  return vim.fs.find({ "biome.json", "biome.jsonc" }, { path = ctx.filename, upward = true })[1]
end

local function has_prettier_config(ctx)
  return vim.fs.find({
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    ".prettierrc.json5",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
  }, { path = ctx.filename, upward = true })[1]
end

return {
  {
    "stevearc/conform.nvim",
    opts = {
      formatters = {
        biome = {
          condition = function(_, ctx)
            return has_biome_config(ctx)
          end,
        },
        prettier = {
          condition = function(_, ctx)
            return has_prettier_config(ctx) and not has_biome_config(ctx)
          end,
        },
      },
      formatters_by_ft = {
        typescript = { "biome", "prettier", stop_after_first = true },
        javascript = { "biome", "prettier", stop_after_first = true },
        typescriptreact = { "biome", "prettier", stop_after_first = true },
        javascriptreact = { "biome", "prettier", stop_after_first = true },
        json = { "biome", "prettier", stop_after_first = true },
      },
    },
  },
}
