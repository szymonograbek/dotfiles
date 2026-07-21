import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

const AUTO_COMPACT_LABEL = " (auto)";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();
					const sessionName = pi.getSessionName();
					const location = formatLocation(ctx.cwd, branch, sessionName);
					const locationLine = truncateToWidth(
						theme.fg("dim", location),
						width,
						theme.fg("dim", "…"),
					);

					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextPercent = usage?.percent === null || usage?.percent === undefined
						? "?"
						: `${usage.percent.toFixed(1)}%`;
					const contextText = `${contextPercent}/${formatTokens(contextWindow)}${AUTO_COMPACT_LABEL}`;
					const leftParts = [colorContext(theme, contextText, usage?.percent)];

					const statuses = Array.from(footerData.getExtensionStatuses().entries())
						.sort(([left], [right]) => left.localeCompare(right))
						.map(([, text]) => sanitizeStatus(text));
					leftParts.push(...statuses);

					const left = leftParts.join(theme.fg("dim", " · "));
					const model = ctx.model?.id ?? "no-model";
					const effort = ctx.model?.reasoning ? ` • ${pi.getThinkingLevel()}` : "";
					const right = theme.fg("dim", `${model}${effort}`);

					return [locationLine, alignRight(left, right, width, theme.fg("dim", "…"))];
				},
			};
		});
	});
}

function formatLocation(cwd: string, branch: string | null, sessionName: string | undefined): string {
	const parts = [abbreviateHome(cwd)];
	if (branch) parts[0] = `${parts[0]} (${branch})`;
	if (sessionName) parts.push(sessionName);
	return parts.join(" • ");
}

function abbreviateHome(path: string): string {
	const home = resolve(homedir());
	const absolutePath = resolve(path);
	const relativePath = relative(home, absolutePath);
	const isInsideHome = relativePath === ""
		|| (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));

	if (!isInsideHome) return path;
	return relativePath === "" ? "~" : `~${sep}${relativePath}`;
}

function colorContext(
	theme: Theme,
	text: string,
	percent: number | null | undefined,
): string {
	if (percent !== null && percent !== undefined && percent > 90) return theme.fg("error", text);
	if (percent !== null && percent !== undefined && percent > 70) return theme.fg("warning", text);
	return theme.fg("dim", text);
}

function alignRight(left: string, right: string, width: number, ellipsis: string): string {
	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) return truncateToWidth(right, width, ellipsis);

	const availableLeft = width - rightWidth - 1;
	const visibleLeft = truncateToWidth(left, availableLeft, ellipsis);
	const padding = " ".repeat(Math.max(1, width - visibleWidth(visibleLeft) - rightWidth));
	return visibleLeft + padding + right;
}

function sanitizeStatus(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}
