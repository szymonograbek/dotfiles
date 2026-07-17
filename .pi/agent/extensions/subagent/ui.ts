import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync } from "node:fs";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { isActive, statusLabel, truncateTask, type SubagentRecord, type SubagentStatus } from "./domain.ts";
import type { SubagentStore } from "./store.ts";
import { contentText, isRecord } from "./validation.ts";

type Theme = {
	fg(color: "accent" | "success" | "warning" | "error" | "dim" | "muted" | "text", text: string): string;
	bold(text: string): string;
};
type AgentActivity = { activity: string; toolUses: number; contextTokens?: number };

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TOOL_ACTIVITY: Record<string, string> = { read: "reading", bash: "running command", edit: "editing", write: "writing", grep: "searching", find: "finding files", ls: "listing files" };

function firstLine(text: string, maxLength = 80): string {
	const line = text.split("\n").map((part) => part.trim()).find((part) => part !== "") ?? "";
	return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

function compactCount(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
	return String(value);
}

function usageTokens(message: Record<string, unknown>): number | undefined {
	const usage = message.usage;
	if (!isRecord(usage)) return undefined;
	if (typeof usage.totalTokens === "number") return usage.totalTokens;
	const total = ["input", "output", "cacheRead", "cacheWrite"].reduce((sum, field) => {
		const value = usage[field];
		return sum + (typeof value === "number" ? value : 0);
	}, 0);
	return total > 0 ? total : undefined;
}

class ActivityReader {
	private readonly cache = new Map<string, { size: number; activity: AgentActivity }>();

	read(record: SubagentRecord): AgentActivity {
		if (record.sessionFile === undefined || !existsSync(record.sessionFile)) return { activity: "starting…", toolUses: 0 };
		try {
			const size = statSync(record.sessionFile).size;
			const cached = this.cache.get(record.id);
			if (cached?.size === size) return cached.activity;
			const pendingTools = new Map<string, string>();
			let latestText = "";
			let contextTokens: number | undefined;
			let toolUses = 0;
			for (const line of readFileSync(record.sessionFile, "utf8").split("\n")) {
				if (line.trim() === "") continue;
				let entry: unknown;
				try { entry = JSON.parse(line); } catch { continue; }
				if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
				const message = entry.message;
				if (message.role === "assistant") {
					pendingTools.clear();
					latestText = contentText(message.content);
					contextTokens = usageTokens(message) ?? contextTokens;
					if (Array.isArray(message.content)) {
						for (const block of message.content) {
							if (!isRecord(block) || block.type !== "toolCall" || typeof block.id !== "string") continue;
							pendingTools.set(block.id, typeof block.name === "string" ? block.name : "tool");
						}
					}
				}
				if (message.role === "toolResult") {
					toolUses += 1;
					if (typeof message.toolCallId === "string") pendingTools.delete(message.toolCallId);
				}
			}
			const pending = [...pendingTools.values()];
			const activity = pending.length > 0
				? [...new Set(pending.map((tool) => TOOL_ACTIVITY[tool] ?? tool))].join(", ") + "…"
				: firstLine(latestText) || (record.status === "working" ? "thinking…" : statusLabel(record.status));
			const result = { activity, toolUses, contextTokens };
			this.cache.set(record.id, { size, activity: result });
			return result;
		} catch {
			return { activity: "working…", toolUses: 0 };
		}
	}
}

function elapsed(startTime: number): string {
	const seconds = Math.max(0, (Date.now() - startTime) / 1000);
	return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}
function shortAge(timestamp: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}
function borderLine(left: string, fill: string, right: string, width: number): string {
	return truncateToWidth(`${left}${fill.repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(right)))}${right}`, width, "");
}
function statusDot(status: SubagentStatus, theme: Theme): string {
	if (status === "completed") return theme.fg("success", "●");
	if (status === "working" || status === "starting") return theme.fg("warning", "●");
	if (status === "failed") return theme.fg("error", "●");
	if (status === "stopped") return theme.fg("muted", "■");
	return " ";
}

export class StatusWidget {
	private context: ExtensionContext | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private frame = 0;
	private readonly activity = new ActivityReader();

	constructor(private readonly store: SubagentStore) {}

	start(ctx: ExtensionContext): void {
		this.context = ctx;
		this.refresh();
		if (this.timer !== undefined) return;
		this.timer = setInterval(() => { this.frame += 1; this.refresh(); }, 100);
	}

	stop(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
		this.context?.ui.setWidget("subagent-status", undefined);
		this.context = undefined;
	}

	refresh(): void {
		const ctx = this.context;
		if (ctx === undefined || !ctx.hasUI) return;
		const records = this.store.sorted().filter((record) => isActive(record.status)).reverse();
		if (records.length === 0) { this.stop(); return; }
		const theme = ctx.ui.theme;
		const width = Math.max(1, (process.stdout.columns ?? 80) - 4);
		const oldest = Math.min(...records.map((record) => record.createdAt));
		const spinner = SPINNER[this.frame % SPINNER.length] ?? "⠋";
		const lines = [`${theme.fg("accent", `${spinner} Agents`)} ${theme.fg("dim", `· ${records.length} running · ${elapsed(oldest)}`)}`];
		for (const [index, record] of records.entries()) {
			const last = index === records.length - 1;
			const activity = this.activity.read(record);
			const stats: string[] = [];
			if (activity.toolUses > 0) stats.push(`${activity.toolUses} tool use${activity.toolUses === 1 ? "" : "s"}`);
			if (activity.contextTokens !== undefined) stats.push(record.contextWindow === undefined ? `${compactCount(activity.contextTokens)} tokens` : `${Math.min(100, activity.contextTokens / record.contextWindow * 100).toFixed(1)}%/${compactCount(record.contextWindow)} ctx`);
			lines.push(`${theme.fg("dim", last ? "└─" : "├─")} ${theme.fg("warning", "●")} ${theme.bold(`Subagent ${index + 1}`)}${record.modelRef === undefined ? "" : ` ${theme.fg("muted", `[${record.modelRef}]`)}`}${stats.length === 0 ? "" : ` ${theme.fg("dim", `· ${stats.join(" · ")}`)}`}`);
			lines.push(`${theme.fg("dim", last ? "   " : "│  ")}  ${theme.fg("muted", firstLine(record.task, 72))}`);
			lines.push(`${theme.fg("dim", last ? "   " : "│  ")}  ${theme.fg("dim", activity.activity)}`);
		}
		ctx.ui.setWidget("subagent-status", lines.map((line) => truncateToWidth(line, width)), { placement: "aboveEditor" });
	}
}

export class SubagentsModal implements Component {
	private selected = 0;
	private message = "";
	private readonly activity = new ActivityReader();

	constructor(
		private readonly store: SubagentStore,
		private readonly theme: Theme,
		private readonly onOpen: (record: SubagentRecord) => void,
		private readonly onStop: (record: SubagentRecord) => void,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
	) {}

	handleInput(data: string): void {
		const records = this.store.sorted();
		if (matchesKey(data, Key.escape)) return this.onClose();
		if (matchesKey(data, Key.up)) { this.selected = Math.max(0, this.selected - 1); return this.requestRender(); }
		if (matchesKey(data, Key.down)) { this.selected = Math.min(Math.max(0, records.length - 1), this.selected + 1); return this.requestRender(); }
		const record = records[this.selected];
		if (record === undefined) return;
		if (matchesKey(data, Key.enter)) return this.onOpen(record);
		if (data === "x" || data === "s") {
			this.onStop(record);
			this.message = `Stop requested for ${truncateTask(record.task)}`;
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const modalWidth = Math.max(1, Math.min(width, 104));
		const innerWidth = Math.max(0, modalWidth - 4);
		const records = this.store.sorted();
		if (this.selected >= records.length) this.selected = Math.max(0, records.length - 1);
		const running = records.filter((record) => isActive(record.status)).length;
		const completed = records.filter((record) => record.status === "completed").length;
		const lines = [
			this.theme.fg("accent", borderLine("╭─ Subagent Manager ", "─", "╮", modalWidth)),
			`│ ${truncateToWidth(`${this.theme.bold("Agents")} ${this.theme.fg("dim", `· ${running} running · ${completed} completed · ${records.length} total`)}`, innerWidth)} │`,
			`│ ${truncateToWidth(this.theme.fg("dim", "↑↓ navigate  •  Enter open/focus  •  x stop  •  Esc close  •  Alt+S toggle"), innerWidth)} │`,
			this.theme.fg("accent", borderLine("├", "─", "┤", modalWidth)),
		];
		if (records.length === 0) lines.push(`│ ${truncateToWidth(this.theme.fg("muted", "No subagents yet."), innerWidth)} │`);
		const start = Math.max(0, Math.min(this.selected - 2, records.length - 6));
		const end = Math.min(records.length, start + 6);
		for (let index = start; index < end; index += 1) {
			const record = records[index];
			if (record === undefined) continue;
			const selected = index === this.selected;
			const label = selected ? this.theme.bold(statusLabel(record.status)) : statusLabel(record.status);
			const age = isActive(record.status) ? elapsed(record.createdAt) : shortAge(record.updatedAt);
			lines.push(`│ ${truncateToWidth(`${selected ? this.theme.fg("accent", "›") : " "} ${statusDot(record.status, this.theme)} ${label} ${this.theme.fg("dim", `· ${age}${record.modelRef === undefined ? "" : ` · ${record.modelRef}`}`)}`, innerWidth)} │`);
			lines.push(`│ ${truncateToWidth(`  └─ ${this.theme.fg("muted", firstLine(record.task, 82))}`, innerWidth)} │`);
			if (selected) lines.push(`│ ${truncateToWidth(`     ${this.theme.fg("dim", this.activity.read(record).activity)}`, innerWidth)} │`);
		}
		if (records.length > 6) lines.push(`│ ${truncateToWidth(this.theme.fg("dim", `  showing ${start + 1}–${end} of ${records.length}`), innerWidth)} │`);
		const selectedRecord = records[this.selected];
		if (selectedRecord !== undefined) {
			lines.push(this.theme.fg("accent", borderLine("├─ Details ", "─", "┤", modalWidth)));
			const detail = this.message || selectedRecord.error || selectedRecord.result || "No final result yet.";
			lines.push(`│ ${truncateToWidth(this.theme.fg(selectedRecord.error === undefined ? "muted" : "error", firstLine(detail, 96)), innerWidth)} │`);
		}
		lines.push(this.theme.fg("accent", borderLine("╰", "─", "╯", modalWidth)));
		return lines;
	}

	invalidate(): void {}
}
