local opts = { noremap = true, silent = true }

local term_opts = { silent = true }

local keymap = vim.api.nvim_set_keymap

-- Remap space to leader
keymap("", "<Space>", "<Nop>", opts)
vim.g.mapleader = " "
vim.g.maplocalleader = " "

---- Normal
keymap("n", "<C-h>", "<C-w>h", opts)
keymap("n", "<C-j>", "<C-w>j", opts)
keymap("n", "<C-k>", "<C-w>k", opts)
keymap("n", "<C-l>", "<C-w>l", opts)
keymap("n", "<leader>w", ":update<CR>", opts)
keymap("n", "<leader>h", ":noh<CR>", opts)

-- Git
keymap("n", "<leader>gg", ":LazyGit<CR>", opts)
keymap("n", "<leader>gd", ":DiffviewOpen<CR>", opts)
keymap("n", "<leader>gfh", ":DiffviewFileHistory %<CR>", opts)
keymap("n", "<leader>gh", ":DiffviewOpen<CR>", opts)
keymap("n", "<leader>ge", "::DiffviewToggleFiles<CR>", opts)
keymap("n", "<leader>gc", ":tabclose<CR>", opts)

-- Buffers
keymap("n", "<S-l>", ":bnext<CR>", opts)
keymap("n", "<S-h>", ":bprevious<CR>", opts)
keymap("n", "<leader>c", ":bd<CR>", opts)
keymap("n", "<leader>x", ":%bd|e#|bd#<CR>", opts)

---- Insert

---- Visual

-- Indents
keymap("v", "<", "<gv", opts)
keymap("v", ">", ">gv", opts)

-- Move text up and down
keymap("v", "<C-j>", ":m .+1<CR>==", opts)
keymap("v", "<C-k>", ":m .-2<CR>==", opts)
keymap("v", "p", '"_dP', opts)

---- Visual blocks
keymap("x", "J", ":move '>+1<CR>gv-gv", opts)
keymap("x", "K", ":move '<-2<CR>gv-gv", opts)
keymap("x", "<C-j>", ":move '>+1<CR>gv-gv", opts)
keymap("x", "<C-k>", ":move '<-2<CR>gv-gv", opts)

---- Nvimtree
keymap("n", "<leader>e", ":NvimTreeFindFileToggle<cr>", opts)

---- Telescope
keymap("n", "<leader>ff", "<cmd> Telescope find_files<cr>", opts)
keymap("n", "<leader>fw", "<cmd> Telescope live_grep<cr>", opts)
keymap("n", "<leader>fa", "<cmd> Telescope find_files follow=true no_ignore=true hidden=true <CR>", opts)
