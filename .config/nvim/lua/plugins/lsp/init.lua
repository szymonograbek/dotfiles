-- require("plugins/lsp/lspconfig")
-- require("plugins/lsp/cmp")
local lsp = require("lsp-zero").preset({})
local cmp = require("cmp")
local cmp_action = require("lsp-zero").cmp_action()
local select_opts = { behavior = "select" }

-- Fix Undefined global 'vim'
-- lsp.configure("lua-language-server", {
-- 	settings = {
-- 		Lua = {
-- 			diagnostics = {
-- 				globals = { "vim" },
-- 			},
-- 		},
-- 	},
-- })

lsp.on_attach(function(client, bufnr)
	lsp.default_keymaps({ buffer = bufnr })

	vim.keymap.set("n", "K", "<cmd>lua vim.lsp.buf.hover()<cr>")
	vim.keymap.set("n", "gd", "<cmd>lua vim.lsp.buf.definition()<cr>")
	vim.keymap.set("n", "gD", "<cmd>lua vim.lsp.buf.declaration()<cr>")
	vim.keymap.set("n", "gi", "<cmd>lua vim.lsp.buf.implementation()<cr>")
	vim.keymap.set("n", "go", "<cmd>lua vim.lsp.buf.type_definition()<cr>")
	vim.keymap.set("n", "gr", "<cmd>lua vim.lsp.buf.references()<cr>")
	vim.keymap.set("n", "<C-k>", "<cmd>lua vim.lsp.buf.signature_help()<cr>")
	vim.keymap.set("n", "vcr", "<cmd>lua vim.lsp.buf.rename()<cr>")
	vim.keymap.set("n", "vca", "<cmd>lua vim.lsp.buf.code_action()<cr>")

	-- Diagnostics
	vim.keymap.set("n", "gl", "<cmd>lua vim.diagnostic.open_float()<cr>")
	vim.keymap.set("n", "[d", "<cmd>lua vim.diagnostic.goto_prev()<cr>")
	vim.keymap.set("n", "]d", "<cmd>lua vim.diagnostic.goto_next()<cr>")
end)

-- (Optional) Configure lua language server for neovim
require("lspconfig").lua_ls.setup(lsp.nvim_lua_ls())

lsp.setup()

cmp.setup({
	mapping = {
		-- confirm selection
		["<cr>"] = cmp.mapping.confirm({ select = true }),

		-- Trigger completion menu
		["<C-Space>"] = cmp.mapping.complete(),

		-- navigate items on the list
		["<C-k>"] = cmp.mapping.select_prev_item(select_opts),
		["<C-j>"] = cmp.mapping.select_next_item(select_opts),

		-- scroll up and down in the completion documentation
		["<C-u>"] = cmp.mapping.scroll_docs(5),
		["<C-d>"] = cmp.mapping.scroll_docs(-5),

		-- scroll between placeholder
		["<C-f>"] = cmp_action.luasnip_jump_forward(),
		["<C-b>"] = cmp_action.luasnip_jump_backward(),
	},
})
