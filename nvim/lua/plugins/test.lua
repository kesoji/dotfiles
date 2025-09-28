return {
  { "marilari88/neotest-vitest" },
  {
    "nvim-neotest/neotest",
    opts = {
      adapters = {
        "neotest-vitest",
        ["neotest-golang"] = {
          -- Here we can set options for neotest-golang, e.g.
          -- go_test_args = { "-v", "-race", "-count=1", "-timeout=60s" },
          dap_go_enabled = true, -- requires leoluz/nvim-dap-go
          runner = "gotestsum",
          go_test_args = {
            "-v",
            "-race",
            "-count=1",
            -- "-coverprofile=" .. vim.fn.getcwd() .. "/coverage.out",
          },
        },
      },
    },
  },
}
