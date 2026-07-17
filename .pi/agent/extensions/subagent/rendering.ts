import { Text } from "@earendil-works/pi-tui";
import type { SubagentDetails, SubagentRecord, TextUpdate, UpdateProgress } from "./domain.ts";
import { agentLabel, truncateTask } from "./domain.ts";
import type { SubagentInput } from "./requests.ts";

type ToolCallTheme = { fg(color: "toolTitle" | "accent", text: string): string; bold(text: string): string };
type ToolResultTheme = { fg(color: "toolOutput" | "muted", text: string): string };

function progressText(index: number, total: number, status: string, task: string): string {
	return `${agentLabel(index, total)}: ${status} — ${truncateTask(task)}`;
}

export function createProgressReporter(
	records: SubagentRecord[],
	onUpdate: ((update: TextUpdate) => void) | undefined,
	currentRecord: (id: string) => SubagentRecord | undefined,
): UpdateProgress {
	const statuses = records.map((record, index) => progressText(index + 1, records.length, "queued", record.task));
	return (index, text) => {
		const record = records[index - 1];
		statuses[index - 1] = progressText(index, records.length, text, record?.task ?? "");
		const agents = records.map((original) => currentRecord(original.id) ?? original);
		onUpdate?.({ content: [{ type: "text", text: statuses.join("\n") }], details: { agents } });
	};
}

function quoted(text: string): string {
	return `"${text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

export function formatSubagentCall(params: SubagentInput, theme: ToolCallTheme): string {
	const title = theme.fg("toolTitle", theme.bold("Run Subagent"));
	if (params.agents !== undefined && params.agents.length > 0) return `${title} ${theme.fg("accent", `${params.agents.length} agents`)}`;
	const task = params.task?.trim();
	return task && task.length > 0 ? `${title} ${theme.fg("accent", quoted(truncateTask(task)))}` : title;
}

export function renderCollapsedResult(result: { readonly details?: SubagentDetails }, isPartial: boolean, theme: ToolResultTheme): Text {
	if (isPartial) return new Text(theme.fg("muted", "Agents are running in terminal surfaces…"), 0, 0);
	const agents = result.details?.agents ?? [];
	const completed = agents.filter((agent) => agent.status === "completed").length;
	const failed = agents.filter((agent) => agent.status === "failed" || agent.status === "stopped").length;
	const detached = agents.filter((agent) => agent.status === "detached").length;
	const parts = [`${completed} completed`];
	if (failed > 0) parts.push(`${failed} failed/stopped`);
	if (detached > 0) parts.push(`${detached} detached`);
	return new Text(theme.fg("toolOutput", `Agents · ${parts.join(" · ")}`), 0, 0);
}

export function renderExpandedResult(result: { readonly content: readonly { readonly type: string; readonly text?: string }[] }, isPartial: boolean, theme: ToolResultTheme): Text {
	const content = result.content[0];
	const text = content?.type === "text" && typeof content.text === "string" ? content.text : "";
	return new Text(text ? theme.fg("toolOutput", text) : isPartial ? theme.fg("muted", "Subagents running…") : "", 0, 0);
}
