return {
	{
		"ThePrimeagen/harpoon",
		branch = "harpoon2",
		dependencies = { "nvim-lua/plenary.nvim" },
		config = function()
			local harpoon = require("harpoon")
			harpoon:setup()

			local harpoon_extensions = require("harpoon.extensions")
			harpoon:extend(harpoon_extensions.builtins.highlight_current_file())

			require("harpoon-tabline").setup()
		end,
	},
}
