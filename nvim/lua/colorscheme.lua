vim.cmd [[
try
  colorscheme ayu-mirage
  "colorscheme ayu-light
  "colorscheme ayu-dark
  "colorscheme ayu
  "colorscheme tokyonight
  "colorscheme tokyonight-night
  "colorscheme tokyonight-storm
  "colorscheme tokyonight-day
  "colorscheme tokyonight-moon
catch /^Vim\%((\a\+)\)\=:E185/
  colorscheme default
  set background=dark
endtry
]]
