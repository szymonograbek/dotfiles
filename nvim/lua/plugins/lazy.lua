local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
	vim.fn.system({
		"git",
		"clone",
		"--filter=blob:none",
		"https://github.com/folke/lazy.nvim.git",
		"--branch=stable", -- latest stable release
		lazypath,
	})
end

vim.opt.rtp:prepend(lazypath)

return require("lazy").setup({
	-- General
	"nvim-lua/popup.nvim",
	"nvim-lua/plenary.nvim",
	"kyazdani42/nvim-web-devicons",
	"windwp/nvim-autopairs",
	"numToStr/Comment.nvim",
	"lewis6991/gitsigns.nvim",
	"nvim-lualine/lualine.nvim",
	"lewis6991/impatient.nvim",
	"lukas-reineke/indent-blankline.nvim",
	"norcalli/nvim-colorizer.lua",
	"sindrets/diffview.nvim",
	"kdheepak/lazygit.nvim",

	-- Colorschemes
	"folke/tokyonight.nvim",
	{
		"olimorris/onedarkpro.nvim",
		priority = 1000, -- Ensure it loads first""
	},
	{
		"VonHeikemen/lsp-zero.nvim",
		branch = "v2.x",
		dependencies = {
			-- LSP Support
			{ "neovim/nvim-lspconfig" }, -- Required
			{ -- Optional
				"williamboman/mason.nvim",
				build = function()
					pcall(vim.cmd, "MasonUpdate")
				end,
			},
			{ "williamboman/mason-lspconfig.nvim" }, -- Optional

			-- Autocompletion
			{ "hrsh7th/nvim-cmp" }, -- Required
			{ "hrsh7th/cmp-nvim-lsp" }, -- Required
			{ "L3MON4D3/LuaSnip" }, -- Required
		},
	},

	-- Telescope
	{ "nvim-telescope/telescope.nvim", tag = "0.1.0" },

	-- Treesitter
	{
		"nvim-treesitter/nvim-treesitter",
		build = function()
			require("nvim-treesitter.install").update({ with_sync = true })
		end,
	},

	-- Nvim-Tree
	{
		"kyazdani42/nvim-tree.lua",
		tag = "nightly", -- optional, updated every week. (see issue #1193)
	},

	-- Bufferline
	{ "akinsho/bufferline.nvim", version = "*" },

	-- Null-ls
	{ "jose-elias-alvarez/null-ls.nvim" },
})
