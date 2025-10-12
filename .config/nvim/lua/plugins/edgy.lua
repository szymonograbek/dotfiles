return {
	"folke/edgy.nvim",
	event = "VeryLazy",
	opts = {
		options = {
			left = { size = 30 },
		},
		animate = {
			enabled = false,
		},
		keys = {
			-- the default action for <c-q> is to hide the window, close instead
			["<c-q>"] = function(win)
				win:close()
			end,
		},
		exit_when_last = true,
		left = {
			{
				title = "Git",
				ft = "neo-tree",
				filter = function(buf)
					return vim.b[buf].neo_tree_source == "git_status"
				end,
				pinned = true,
				open = "Neotree position=right git_status",
			},
			{
				title = "Symbols",
				ft = "Outline",
				pinned = true,
				open = "SymbolsOutlineOpen",
			},
		},
	},
}
