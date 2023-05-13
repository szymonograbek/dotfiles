vim.cmd([[
try
  colorscheme tokyonight-storm
catch /^Vim\%((\a\+)\)\=:E185/
  colorscheme default
  set background=dark
endtry
]])

vim.cmd([[highlight LineNr ctermfg=132 guifg=#c4c4c4]])
