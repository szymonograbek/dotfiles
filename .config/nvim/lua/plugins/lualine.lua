return {
	{
		"nvim-lualine/lualine.nvim",
		event = "VeryLazy",
		config = function()
			local function truncate_branch_name(branch)
				if not branch or branch == "" then
					return ""
				end

				-- Match the branch name to the specified format
				local user, team, ticket_number = string.match(branch, "^(%w+)/(%w+)%-(%d+)")

				-- If the branch name matches the format, display {user}/{team}-{ticket_number}, otherwise display the full branch name
				if ticket_number then
					return user .. "/" .. team .. "-" .. ticket_number
				else
					return branch
				end
			end

			local harpoon = require("harpoon")
			local palette = require("catppuccin.palettes").get_palette("macchiato")

			vim.api.nvim_set_hl(0, "HarpoonInactive", { fg = palette.overlay1, bg = palette.base })
			vim.api.nvim_set_hl(0, "HarpoonActive", { fg = palette.blue, bg = palette.base })
			vim.api.nvim_set_hl(0, "HarpoonNumberActive", { fg = palette.yellow, bg = palette.base })
			vim.api.nvim_set_hl(0, "HarpoonNumberInactive", { fg = palette.peach, bg = palette.base })
			vim.api.nvim_set_hl(0, "TabLineFill", { fg = palette.text, bg = palette.base })

			require("lualine").setup({
				options = {
					theme = "catppuccin",
					globalstatus = true,
					component_separators = { left = "", right = "" },
					section_separators = { left = "█", right = "█" },
				},
				sections = {
					lualine_b = {
						{ "branch", icon = "", fmt = truncate_branch_name },
						"diff",
						"diagnostics",
					},
					lualine_c = {
						{ "filename", path = 1 },
					},
					lualine_x = {
						"filetype",
					},
				},
			})
		end,
	},
}
