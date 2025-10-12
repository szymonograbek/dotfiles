return {
	{
		"hedyhli/outline.nvim",
		cmd = { "Outline" },
		config = function()
			require("outline").setup({
				outline_window = {
					focus_on_open = false,
					position = "right",
				},
			})
		end,
	},
}
