require("nvim-tree").setup({
	disable_netrw = true,
	hijack_netrw = true,
	update_cwd = true,
	diagnostics = {
		enable = true,
		icons = {
			hint = "",
			info = "",
			warning = "",
			error = "",
		},
	},
	git = {
		enable = true,
		ignore = true,
		timeout = 500,
	},
	view = {
		adaptive_size = true,
		mappings = {
			list = {
				{ key = "u", action = "dir_up" },
				{ key = { "l", "<CR>", "o" }, action = "edit" },
			},
		},
		number = false,
		relativenumber = false,
	},
	actions = {
		open_file = {
			quit_on_open = true,
		},
	},
})
