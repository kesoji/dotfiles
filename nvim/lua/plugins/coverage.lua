return {
  "andythigpen/nvim-coverage",
  dependencies = { "nvim-lua/plenary.nvim" },
  config = function()
    require("coverage").setup({
      --[[ デフォルト
      -- コマンド設定
      commands = true,
      ]]

      --[[ デフォルト
      -- ハイライト設定
      highlights = {
        covered = { fg = "#C3E88D" },
        uncovered = { fg = "#F07178" },
      },
      ]]

      --[[ デフォルト
      -- サイン設定（行番号の左側に表示されるマーク）
      signs = {
        covered = { hl = "CoverageCovered", text = "▎" },
        uncovered = { hl = "CoverageUncovered", text = "▎" },
      },
      ]]

      --[[ デフォルト
      -- サマリー設定
      summary = {
        min_coverage = 80.0,
      },
      ]]

      --[[ デフォルト
      -- 自動読み込み設定
      auto_reload = true,
      ]]

      --[[ デフォルト
      -- 言語別設定
      lang = {
        python = {
          coverage_file = vim.fn.getcwd() .. "/coverage.xml",
        },
        javascript = {
          coverage_file = vim.fn.getcwd() .. "/coverage/lcov.info",
        },
        typescript = {
          coverage_file = vim.fn.getcwd() .. "/coverage/lcov.info",
        },
        go = {
          coverage_file = vim.fn.getcwd() .. "/coverage.out",
        },
      },
      ]]
    })
  end,
  keys = {
    { "<leader>tC", "<cmd>Coverage<CR>", desc = "[C] Toggle coverage" },
    { "<leader>tcs", "<cmd>CoverageSummary<CR>", desc = "[C] Coverage summary" },
    { "<leader>tcl", "<cmd>CoverageLoad<CR>", desc = "[C] Load coverage" },
    { "<leader>tcc", "<cmd>CoverageClear<CR>", desc = "[C] Clear coverage" },
  },
}
