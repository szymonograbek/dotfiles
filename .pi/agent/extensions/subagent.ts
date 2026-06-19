import { StringEnum } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { Text, Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const TOOL_NAME = "run_subagent";
const DEFAULT_TOOLS = ["read", "grep", "find", "ls"];
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const agentSchema = Type.Object({
	task: Type.String({ description: "Self-contained task for the subagent." }),
	allowedTools: Type.Optional(
		Type.Array(Type.String(), {
			description: "Tool names this subagent may use. run_subagent is always removed.",
		}),
	),
	includeSkills: Type.Optional(Type.Boolean({ description: "Whether this subagent loads skills." })),
	includeExtensions: Type.Optional(Type.Boolean({ description: "Whether this subagent loads extensions." })),
	includeContextFiles: Type.Optional(
		Type.Boolean({ description: "Whether this subagent loads AGENTS.md and CLAUDE.md context files." }),
	),
	thinkingLevel: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Thinking level for this subagent." })),
});

const schema = Type.Object({
	task: Type.Optional(Type.String({ description: "Self-contained task for a single subagent." })),
	allowedTools: Type.Optional(
		Type.Array(Type.String(), {
			description: "Default tool names subagents may use. run_subagent is always removed.",
		}),
	),
	includeSkills: Type.Optional(Type.Boolean({ description: "Whether subagents load skills. Defaults to true." })),
	includeExtensions: Type.Optional(
		Type.Boolean({ description: "Whether subagents load extensions. Defaults to true." }),
	),
	includeContextFiles: Type.Optional(
		Type.Boolean({ description: "Whether subagents load AGENTS.md and CLAUDE.md context files. Defaults to false." }),
	),
	thinkingLevel: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Default thinking level. Defaults to medium." })),
	agents: Type.Optional(
		Type.Array(agentSchema, {
			description:
				"Subagents to run in parallel. Each item may override allowedTools, includeSkills, includeExtensions, includeContextFiles, and thinkingLevel.",
		}),
	),
});

type SubagentInput = Static<typeof schema>;
type AgentInput = Static<typeof agentSchema>;

type AgentRequest = {
	task: string;
	allowedTools: string[];
	includeSkills: boolean;
	includeExtensions: boolean;
	includeContextFiles: boolean;
	thinkingLevel: ThinkingLevel;
};

type SubagentStatus = "queued" | "starting" | "thinking" | "working" | "completed" | "failed" | "stopped";

type SubagentRecord = AgentRequest & {
	id: string;
	status: SubagentStatus;
	createdAt: number;
	updatedAt: number;
	sessionFile?: string;
	sessionId?: string;
	result?: string;
	error?: string;
	herdrTarget?: string;
};

type SubagentDetails = { agents: SubagentRecord[] };
type TextUpdate = { content: Array<{ type: "text"; text: string }>; details: SubagentDetails };
type UpdateProgress = (index: number, text: string) => void;
type ToolCallTheme = {
	fg(color: "toolTitle" | "accent", text: string): string;
	bold(text: string): string;
};
type ToolResultTheme = {
	fg(color: "toolOutput" | "muted", text: string): string;
};

type RunAgentArgs = AgentRequest & {
	id: string;
	index: number;
	total: number;
	cwd: string;
	model: ExtensionContext["model"];
	signal: AbortSignal | undefined;
	updateProgress: UpdateProgress;
	setSession: (id: string, sessionFile: string | undefined, sessionId: string) => void;
};

const subagents = new Map<string, SubagentRecord>();
const abortControllers = new Map<string, AbortController>();

function upsertSubagent(record: SubagentRecord): void {
	subagents.set(record.id, record);
}

function updateSubagent(id: string, patch: Partial<SubagentRecord>): SubagentRecord | undefined {
	const current = subagents.get(id);
	if (current === undefined) {
		return undefined;
	}
	const next = { ...current, ...patch, updatedAt: Date.now() };
	subagents.set(id, next);
	return next;
}

function sortedSubagents(): SubagentRecord[] {
	return [...subagents.values()].sort((left, right) => right.createdAt - left.createdAt);
}

function stopSubagent(id: string): boolean {
	const controller = abortControllers.get(id);
	if (controller === undefined) {
		return false;
	}
	controller.abort();
	abortControllers.delete(id);
	updateSubagent(id, { status: "stopped" });
	return true;
}

function sanitizeTools(tools: string[] | undefined): string[] {
	const filtered = (tools ?? DEFAULT_TOOLS).filter((tool) => tool !== TOOL_NAME);
	return filtered.includes("read") ? filtered : ["read", ...filtered];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function contentText(content: unknown): string {
	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.flatMap((item) => {
			if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
				const text = item.text.trim();
				return text === "" ? [] : [text];
			}
			return [];
		})
		.join("\n");
}

function resultText(result: unknown): string {
	return isRecord(result) ? contentText(result.content) : "";
}

function finalResponseFromMessages(messages: readonly unknown[]): string {
	let latestToolText = "";

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!isRecord(message)) {
			continue;
		}

		const text = contentText(message.content);
		if (text === "") {
			continue;
		}

		if (message.role === "assistant") {
			return text;
		}
		if (message.role === "toolResult" && latestToolText === "") {
			latestToolText = text;
		}
	}

	return latestToolText;
}

function truncateTask(task: string): string {
	const singleLine = task.replace(/\s+/g, " ").trim();
	return singleLine.length > 80 ? `${singleLine.slice(0, 77)}…` : singleLine;
}

function agentLabel(index: number, total: number): string {
	return total === 1 ? "Subagent" : `Subagent ${index}/${total}`;
}

function progressText(index: number, total: number, status: string, task: string): string {
	return `${agentLabel(index, total)}: ${status} — ${truncateTask(task)}`;
}

function createProgressReporter(
	records: SubagentRecord[],
	onUpdate: ((update: TextUpdate) => void) | undefined,
): UpdateProgress {
	const total = records.length;
	const statuses = records.map((record, index) => progressText(index + 1, total, "queued", record.task));

	return (index, text) => {
		const record = records[index - 1];
		statuses[index - 1] = progressText(index, total, text, record?.task ?? "");
		onUpdate?.({ content: [{ type: "text", text: statuses.join("\n") }], details: { agents: records } });
	};
}

function quoted(text: string): string {
	return `"${text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function formatSubagentCall(params: SubagentInput, theme: ToolCallTheme): string {
	const title = theme.fg("toolTitle", theme.bold("Run Subagent"));
	if (params.agents !== undefined && params.agents.length > 0) {
		return `${title} ${theme.fg("accent", `${params.agents.length} agents`)}`;
	}

	const task = params.task?.trim();
	return task && task.length > 0 ? `${title} ${theme.fg("accent", quoted(truncateTask(task)))}` : title;
}

function textContent(result: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
	const content = result.content[0];
	return content?.type === "text" && typeof content.text === "string" ? content.text : "";
}

function renderCollapsedResult(): Text {
	return new Text("", 0, 0);
}

function renderExpandedResult(
	result: { readonly content: readonly { readonly type: string; readonly text?: string }[] },
	isPartial: boolean,
	theme: ToolResultTheme,
): Text {
	const text = textContent(result);
	return new Text(text ? theme.fg("toolOutput", text) : isPartial ? theme.fg("muted", "Subagents running…") : "", 0, 0);
}

function buildRequest(params: SubagentInput, agent: AgentInput): AgentRequest {
	return {
		task: agent.task,
		allowedTools: sanitizeTools(agent.allowedTools ?? params.allowedTools),
		includeSkills: agent.includeSkills ?? params.includeSkills ?? true,
		includeExtensions: agent.includeExtensions ?? params.includeExtensions ?? true,
		includeContextFiles: agent.includeContextFiles ?? params.includeContextFiles ?? false,
		thinkingLevel: agent.thinkingLevel ?? params.thinkingLevel ?? "medium",
	};
}

function buildRequests(params: SubagentInput): AgentRequest[] {
	if (params.agents !== undefined && params.agents.length > 0) {
		return params.agents.map((agent) => buildRequest(params, agent));
	}

	if (params.task === undefined) {
		throw new Error("Provide either task for one subagent or agents for parallel subagents.");
	}

	return [
		{
			task: params.task,
			allowedTools: sanitizeTools(params.allowedTools),
			includeSkills: params.includeSkills ?? true,
			includeExtensions: params.includeExtensions ?? true,
			includeContextFiles: params.includeContextFiles ?? false,
			thinkingLevel: params.thinkingLevel ?? "medium",
		},
	];
}

function createRecord(request: AgentRequest): SubagentRecord {
	const now = Date.now();
	return { ...request, id: randomUUID(), status: "queued", createdAt: now, updatedAt: now };
}

type SubagentTheme = {
	fg(color: "accent" | "success" | "warning" | "error" | "dim" | "muted" | "text", text: string): string;
	bold(text: string): string;
};

function statusDot(status: SubagentStatus, theme: SubagentTheme): string {
	if (status === "completed") {
		return theme.fg("success", "●");
	}
	if (status === "thinking" || status === "working" || status === "starting") {
		return theme.fg("warning", "●");
	}
	if (status === "failed") {
		return theme.fg("error", "●");
	}
	if (status === "stopped") {
		return theme.fg("muted", "■");
	}
	return " ";
}

function statusLabel(status: SubagentStatus): string {
	if (status === "completed") {
		return "Done";
	}
	if (status === "thinking" || status === "working" || status === "starting") {
		return "Working";
	}
	if (status === "failed") {
		return "Failed";
	}
	if (status === "stopped") {
		return "Stopped";
	}
	return "Not started";
}

function shortAge(timestamp: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	return `${Math.floor(minutes / 60)}h`;
}

function borderLine(left: string, fill: string, right: string, width: number): string {
	const inner = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
	return `${left}${fill.repeat(inner)}${right}`;
}

function openCommand(record: SubagentRecord, cwd: string): string[] | undefined {
	const session = record.sessionFile ?? record.sessionId;
	if (session === undefined) {
		return undefined;
	}
	return ["agent", "start", `subagent: ${truncateTask(record.task)}`, "--cwd", cwd, "--focus", "--", "pi", "--session", session];
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	return THINKING_LEVELS.some((level) => level === value);
}

class SubagentsModal implements Component {
	private selected = 0;
	private message = "";

	constructor(
		private readonly theme: SubagentTheme,
		private readonly onOpen: (record: SubagentRecord) => void,
		private readonly onStop: (record: SubagentRecord) => void,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
	) {}

	handleInput(data: string): void {
		const records = sortedSubagents();
		if (matchesKey(data, Key.escape)) {
			this.onClose();
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.selected = Math.max(0, this.selected - 1);
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.selected = Math.min(Math.max(0, records.length - 1), this.selected + 1);
			this.requestRender();
			return;
		}
		const selectedRecord = records[this.selected];
		if (selectedRecord === undefined) {
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.onOpen(selectedRecord);
			return;
		}
		if (data === "x" || data === "s") {
			this.onStop(selectedRecord);
			this.message = `Stop requested for ${truncateTask(selectedRecord.task)}`;
			this.requestRender();
		}
	}

	render(width: number): string[] {
		const modalWidth = Math.max(44, Math.min(width, 92));
		const innerWidth = Math.max(0, modalWidth - 4);
		const records = sortedSubagents();
		if (this.selected >= records.length) {
			this.selected = Math.max(0, records.length - 1);
		}

		const lines = [
			this.theme.fg("accent", borderLine("╭─ Subagents ", "─", "╮", modalWidth)),
			`│ ${truncateToWidth(this.theme.fg("dim", "↑↓ select • Enter open in Herdr tab • x stop • Esc close"), innerWidth)} │`,
			this.theme.fg("accent", borderLine("├", "─", "┤", modalWidth)),
		];

		if (records.length === 0) {
			lines.push(`│ ${truncateToWidth(this.theme.fg("muted", "No subagents yet."), innerWidth)} │`);
		} else {
			for (const [index, record] of records.entries()) {
				const prefix = index === this.selected ? this.theme.fg("accent", "›") : " ";
				const label = statusLabel(record.status).padEnd(11, " ");
				const age = shortAge(record.updatedAt).padStart(4, " ");
				const row = `${prefix} ${statusDot(record.status, this.theme)} ${label} ${truncateTask(record.task)} ${this.theme.fg("dim", age)}`;
				lines.push(`│ ${truncateToWidth(row, innerWidth)} │`);
			}
		}

		const selectedRecord = records[this.selected];
		if (selectedRecord?.result !== undefined || selectedRecord?.error !== undefined || this.message !== "") {
			lines.push(this.theme.fg("accent", borderLine("├", "─", "┤", modalWidth)));
			const detail = this.message || selectedRecord?.error || selectedRecord?.result || "";
			lines.push(`│ ${truncateToWidth(this.theme.fg("muted", detail.replace(/\s+/g, " ")), innerWidth)} │`);
		}

		lines.push(this.theme.fg("accent", borderLine("╰", "─", "╯", modalWidth)));
		return lines;
	}

	invalidate(): void {}
}

function restoreSubagents(ctx: ExtensionContext): void {
	subagents.clear();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== "subagent") {
			continue;
		}
		const data = entry.data;
		if (!isRecord(data) || typeof data.id !== "string" || typeof data.task !== "string") {
			continue;
		}
		const now = Date.now();
		const record: SubagentRecord = {
			id: data.id,
			task: data.task,
			allowedTools: Array.isArray(data.allowedTools) ? data.allowedTools.filter((tool): tool is string => typeof tool === "string") : DEFAULT_TOOLS,
			includeSkills: typeof data.includeSkills === "boolean" ? data.includeSkills : true,
			includeExtensions: typeof data.includeExtensions === "boolean" ? data.includeExtensions : true,
			includeContextFiles: typeof data.includeContextFiles === "boolean" ? data.includeContextFiles : false,
			thinkingLevel: typeof data.thinkingLevel === "string" && isThinkingLevel(data.thinkingLevel) ? data.thinkingLevel : "medium",
			status: data.status === "completed" || data.status === "failed" || data.status === "stopped" ? data.status : "queued",
			createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
			updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : now,
			sessionFile: typeof data.sessionFile === "string" ? data.sessionFile : undefined,
			sessionId: typeof data.sessionId === "string" ? data.sessionId : undefined,
			result: typeof data.result === "string" ? data.result : undefined,
			error: typeof data.error === "string" ? data.error : undefined,
			herdrTarget: typeof data.herdrTarget === "string" ? data.herdrTarget : undefined,
		};
		upsertSubagent(record);
	}
}

async function runAgent(args: RunAgentArgs): Promise<string> {
	args.updateProgress(args.index, "starting");

	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd: args.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noSkills: !args.includeSkills,
		noExtensions: !args.includeExtensions,
		noContextFiles: !args.includeContextFiles,
	});
	await loader.reload();

	const sessionManager = SessionManager.create(args.cwd);
	sessionManager.appendSessionInfo(`Subagent: ${truncateTask(args.task)}`);

	const { session } = await createAgentSession({
		cwd: args.cwd,
		agentDir: getAgentDir(),
		resourceLoader: loader,
		settingsManager,
		sessionManager,
		model: args.model,
		tools: args.allowedTools,
		excludeTools: [TOOL_NAME],
		thinkingLevel: args.thinkingLevel,
	});
	args.setSession(args.id, session.sessionFile, session.sessionId);

	let finalText = "";
	let currentAssistantText = "";
	let lastToolText = "";
	let assistantError = "";
	const unsubscribe = session.subscribe((event) => {
		if (event.type === "message_start" && event.message.role === "assistant") {
			currentAssistantText = "";
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			currentAssistantText += event.assistantMessageEvent.delta;
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			const text = contentText(event.message.content) || currentAssistantText.trim();
			if (text !== "") {
				finalText = text;
			}
			if (event.message.stopReason === "error") {
				assistantError = event.message.errorMessage ?? "Subagent failed without an error message.";
			}
		}
		if (event.type === "message_start" && event.message.role === "assistant") {
			updateSubagent(args.id, { status: "thinking" });
			args.updateProgress(args.index, "thinking");
		}
		if (event.type === "tool_execution_start") {
			updateSubagent(args.id, { status: "working" });
			args.updateProgress(args.index, `using ${event.toolName}`);
		}
		if (event.type === "tool_execution_end") {
			const text = resultText(event.result);
			if (!event.isError && text !== "") {
				lastToolText = text;
			}
			args.updateProgress(args.index, event.isError ? `${event.toolName} failed` : "thinking");
		}
		if (event.type === "agent_end") {
			const text = finalResponseFromMessages(event.messages);
			if (text !== "") {
				finalText = text;
			}
		}
	});

	const abort = () => {
		void session.abort();
	};
	args.signal?.addEventListener("abort", abort, { once: true });

	try {
		updateSubagent(args.id, { status: "thinking" });
		await session.prompt(args.task, { source: "extension" });
		finalText = finalText || finalResponseFromMessages(session.messages);
		updateSubagent(args.id, { status: "completed", result: finalText });
		args.updateProgress(args.index, "completed");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = args.signal?.aborted ? "stopped" : "failed";
		updateSubagent(args.id, { status, error: message });
		args.updateProgress(args.index, status);
		throw error;
	} finally {
		args.signal?.removeEventListener("abort", abort);
		unsubscribe();
		session.dispose();
	}

	return finalText || lastToolText || assistantError || `${agentLabel(args.index, args.total)} completed without a final text response.`;
}

export default function (pi: ExtensionAPI) {
	const persistSubagent = (record: SubagentRecord | undefined): void => {
		if (record !== undefined) {
			pi.appendEntry("subagent", record);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		restoreSubagents(ctx);
	});

	pi.registerCommand("subagents", {
		description: "Show persisted subagents and open them in Herdr tabs",
		handler: async (_args, ctx) => {
			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				const modal = new SubagentsModal(
					theme,
					(record) => {
						const args = openCommand(record, ctx.cwd);
						if (args === undefined) {
							ctx.ui.notify("Subagent has no persisted session yet.", "warning");
							return;
						}
						void (async () => {
							const target = `subagent: ${truncateTask(record.task)}`;
							const updated = updateSubagent(record.id, { herdrTarget: target });
							persistSubagent(updated);
							const result = await pi.exec("herdr", args, { timeout: 5000 });
							if (result.code === 0) {
								ctx.ui.notify(`Opened ${target}`, "info");
								done(undefined);
								return;
							}
							ctx.ui.notify(result.stderr || result.stdout || "Failed to open Herdr tab.", "error");
							tui.requestRender();
						})();
					},
					(record) => {
						if (!stopSubagent(record.id)) {
							ctx.ui.notify("Only currently running in-process subagents can be stopped here.", "warning");
							return;
						}
						persistSubagent(subagents.get(record.id));
						ctx.ui.notify(`Stopped ${truncateTask(record.task)}`, "info");
						tui.requestRender();
					},
					() => done(undefined),
					() => tui.requestRender(),
				);
				return modal;
			}, { overlay: true });
		},
	});

	pi.registerTool<typeof schema, SubagentDetails>({
		name: TOOL_NAME,
		label: "Run Subagent",
		description:
			"Delegate one or more self-contained tasks to isolated Pi subagents. Multiple agents run in parallel. The parent receives only terse progress and final answers. Subagents never receive run_subagent.",
		promptSnippet: "Delegate self-contained investigation, review, or research to isolated subagents",
		promptGuidelines: [
			"Use run_subagent when self-contained tasks can be delegated and only final answers are needed.",
			"Use agents to run multiple subagents in parallel; set per-agent thinkingLevel when needed.",
			"Pass the minimum allowedTools needed for the delegated task; run_subagent is always unavailable to subagents.",
		],
		parameters: schema,
		async execute(_toolCallId, params: SubagentInput, signal, onUpdate, ctx) {
			const records = buildRequests(params).map(createRecord);
			for (const record of records) {
				upsertSubagent(record);
				persistSubagent(record);
			}

			const total = records.length;
			const updateProgress = createProgressReporter(records, onUpdate);
			const results = await Promise.all(
				records.map(async (record, index) => {
					const controller = new AbortController();
					abortControllers.set(record.id, controller);
					if (signal !== undefined) {
						signal.addEventListener("abort", () => controller.abort(), { once: true });
					}
					try {
						const result = await runAgent({
							...record,
							index: index + 1,
							total,
							cwd: ctx.cwd,
							model: ctx.model,
							signal: controller.signal,
							updateProgress,
							setSession: (id, sessionFile, sessionId) => {
								persistSubagent(updateSubagent(id, { sessionFile, sessionId, status: "starting" }));
							},
						});
						persistSubagent(subagents.get(record.id));
						return result;
					} catch (error) {
						persistSubagent(subagents.get(record.id));
						const message = error instanceof Error ? error.message : String(error);
						return `${agentLabel(index + 1, total)} ${controller.signal.aborted ? "stopped" : "failed"}: ${message}`;
					} finally {
						abortControllers.delete(record.id);
					}
				}),
			);

			const text =
				results.length === 1
					? results.join("")
					: results.map((result, index) => `## Subagent ${index + 1}/${total}\n\n${result}`).join("\n\n");

			return {
				content: [{ type: "text", text }],
				details: { agents: records },
			};
		},
		renderCall(params, theme) {
			return new Text(formatSubagentCall(params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});
}
