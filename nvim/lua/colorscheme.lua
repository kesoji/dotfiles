vim.cmd [[
try
  colorscheme tokyonight
  "colorscheme tokyonight-night
  "colorscheme tokyonight-storm
  "colorscheme tokyonight-day
  "colorscheme tokyonight-moon
catch /^Vim\%((\a\+)\)\=:E185/
  colorscheme default
  set background=dark
endtry
]]
