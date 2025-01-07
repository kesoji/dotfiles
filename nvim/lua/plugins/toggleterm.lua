return {
  {
    "akinsho/toggleterm.nvim",
    version = "*",
    event = "VeryLazy",
    config = function()
      require("toggleterm").setup({
        size = 100,
        open_mapping = [[<c-@>]],
        hide_numbers = true,
        shade_filetypes = {},
        shade_terminals = true,
        shading_factor = 2,
        start_in_insert = true,
        insert_mappings = true,
        persist_size = true,
        direction = "float",
        close_on_exit = true,
      })
    end,
  },
}
