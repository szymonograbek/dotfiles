import { StringEnum } from "@earendil-works/pi-ai";
import {
	resolveCliModel,
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Text, Key, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const TOOL_NAME = "run_subagent";
const CHILD_ENV = "PI_RUN_SUBAGENT_CHILD";
const CHILD_RESULT_FILE_ENV = "PI_RUN_SUBAGENT_RESULT_FILE";
const DEFAULT_TOOLS = ["read", "grep", "find", "ls"];
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const POLL_INTERVAL_MS = 500;

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
	model: Type.Optional(Type.String({ description: "Model for this subagent, such as gpt-5.6-sol. Subscription-backed variants are preferred." })),
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
	model: Type.Optional(
		Type.String({ description: "Default subagent model. Prefers the parent's subscription-backed equivalent when omitted." }),
	),
	thinkingLevel: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Default thinking level. Defaults to medium." })),
	agents: Type.Optional(
		Type.Array(agentSchema, {
			description:
				"Subagents to run in parallel. Each item may override allowedTools, includeSkills, includeExtensions, includeContextFiles, model, and thinkingLevel.",
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
	model?: string;
	thinkingLevel: ThinkingLevel;
};

type SubagentStatus = "queued" | "starting" | "working" | "completed" | "failed" | "stopped";

type SubagentRecord = AgentRequest & {
	id: string;
	status: SubagentStatus;
	createdAt: number;
	updatedAt: number;
	modelRef?: string;
	contextWindow?: number;
	sessionFile?: string;
	sessionId?: string;
	resultFile?: string;
	launchFile?: string;
	tabId?: string;
	paneId?: string;
	result?: string;
	error?: string;
};

type ChildResult = {
	status: "completed" | "failed" | "stopped";
	error?: string;
};

type HerdrSurface = {
	tabId: string;
	paneId: string;
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
type SubagentTheme = {
	fg(color: "accent" | "success" | "warning" | "error" | "dim" | "muted" | "text", text: string): string;
	bold(text: string): string;
};

type AgentActivity = {
	activity: string;
	toolUses: number;
	contextTokens?: number;
};

const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TOOL_ACTIVITY: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing files",
};

const subagents = new Map<string, SubagentRecord>();
const abortControllers = new Map<string, AbortController>();
const activityCache = new Map<string, { size: number; activity: AgentActivity }>();
let widgetContext: ExtensionContext | undefined;
let widgetTimer: ReturnType<typeof setInterval> | undefined;
let widgetFrame = 0;

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

function firstLine(text: string, maxLength = 80): string {
	const line = text.split("\n").map((part) => part.trim()).find((part) => part !== "") ?? "";
	return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

function compactCount(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
	return String(value);
}

function messageUsageTokens(message: Record<string, unknown>): number | undefined {
	if (!isRecord(message.usage)) return undefined;
	if (typeof message.usage.totalTokens === "number") return message.usage.totalTokens;
	const fields = ["input", "output", "cacheRead", "cacheWrite"];
	const total = fields.reduce((sum, field) => {
		const value = message.usage?.[field];
		return sum + (typeof value === "number" ? value : 0);
	}, 0);
	return total > 0 ? total : undefined;
}

function agentActivity(record: SubagentRecord): AgentActivity {
	if (record.sessionFile === undefined || !existsSync(record.sessionFile)) {
		return { activity: "starting…", toolUses: 0 };
	}

	try {
		const size = statSync(record.sessionFile).size;
		const cached = activityCache.get(record.id);
		if (cached?.size === size) return cached.activity;

		const pendingTools = new Map<string, string>();
		let latestText = "";
		let contextTokens: number | undefined;
		let toolUses = 0;
		const lines = readFileSync(record.sessionFile, "utf8").split("\n").filter((line) => line.trim() !== "");

		for (const line of lines) {
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
			const message = entry.message;
			if (message.role === "assistant") {
				pendingTools.clear();
				latestText = contentText(message.content);
				contextTokens = messageUsageTokens(message) ?? contextTokens;
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
		activityCache.set(record.id, { size, activity: result });
		return result;
	} catch {
		return { activity: "working…", toolUses: 0 };
	}
}

function elapsed(startTime: number): string {
	const seconds = Math.max(0, (Date.now() - startTime) / 1000);
	return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

function stopWidget(): void {
	if (widgetTimer !== undefined) {
		clearInterval(widgetTimer);
		widgetTimer = undefined;
	}
	widgetContext?.ui.setWidget("subagent-status", undefined);
}

function refreshWidget(): void {
	const ctx = widgetContext;
	if (ctx === undefined || !ctx.hasUI) return;
	const records = sortedSubagents().filter((record) => isActive(record.status)).reverse();
	if (records.length === 0) {
		stopWidget();
		return;
	}

	const theme = ctx.ui.theme;
	const width = Math.max(1, (process.stdout.columns ?? 80) - 4);
	const oldest = Math.min(...records.map((record) => record.createdAt));
	const spinner = BRAILLE_SPINNER[widgetFrame % BRAILLE_SPINNER.length] ?? "⠋";
	const lines = [
		`${theme.fg("accent", `${spinner} Agents`)} ${theme.fg("dim", `· ${records.length} running · ${elapsed(oldest)}`)}`,
	];

	for (const [index, record] of records.entries()) {
		const last = index === records.length - 1;
		const connector = last ? "└─" : "├─";
		const continuation = last ? "   " : "│  ";
		const activity = agentActivity(record);
		const stats: string[] = [];
		if (activity.toolUses > 0) stats.push(`${activity.toolUses} tool use${activity.toolUses === 1 ? "" : "s"}`);
		if (activity.contextTokens !== undefined) {
			const context = record.contextWindow;
			stats.push(context === undefined
				? `${compactCount(activity.contextTokens)} tokens`
				: `${Math.min(100, activity.contextTokens / context * 100).toFixed(1)}%/${compactCount(context)} ctx`);
		}
		const header = `${theme.fg("dim", connector)} ${theme.fg("warning", "●")} ${theme.bold(`Subagent ${index + 1}`)}` +
			(record.modelRef === undefined ? "" : ` ${theme.fg("muted", `[${record.modelRef}]`)}`) +
			(stats.length === 0 ? "" : ` ${theme.fg("dim", `· ${stats.join(" · ")}`)}`);
		lines.push(header);
		lines.push(`${theme.fg("dim", continuation)}  ${theme.fg("muted", firstLine(record.task, 72))}`);
		lines.push(`${theme.fg("dim", continuation)}  ${theme.fg("dim", activity.activity)}`);
	}

	ctx.ui.setWidget("subagent-status", lines.map((line) => truncateToWidth(line, width)), { placement: "aboveEditor" });
}

function startWidget(ctx: ExtensionContext): void {
	widgetContext = ctx;
	refreshWidget();
	if (widgetTimer !== undefined) return;
	widgetTimer = setInterval(() => {
		widgetFrame += 1;
		refreshWidget();
	}, 100);
}

function writeChildResult(result: ChildResult): void {
	const resultFile = process.env[CHILD_RESULT_FILE_ENV];
	if (resultFile === undefined || existsSync(resultFile)) {
		return;
	}
	writeFileSync(resultFile, JSON.stringify(result), "utf8");
}

function registerChildLifecycle(pi: ExtensionAPI): void {
	let agentStarted = false;
	let operatorIntervened = false;
	let lastStopReason = "";
	let lastError = "";

	pi.on("agent_start", () => {
		agentStarted = true;
		operatorIntervened = false;
	});

	pi.on("input", (event) => {
		if (agentStarted && event.source !== "extension") {
			operatorIntervened = true;
		}
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") {
			return;
		}
		lastStopReason = event.message.stopReason;
		lastError = event.message.errorMessage ?? "";
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (lastStopReason === "aborted" || operatorIntervened) {
			return;
		}
		if (lastStopReason === "error") {
			writeChildResult({ status: "failed", error: lastError || "Subagent model request failed." });
		} else {
			writeChildResult({ status: "completed" });
		}
		ctx.shutdown();
	});

	pi.on("session_shutdown", () => {
		writeChildResult({ status: "stopped" });
	});
}

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

function sanitizeTools(tools: string[] | undefined): string[] {
	const filtered = (tools ?? DEFAULT_TOOLS).filter((tool) => tool !== TOOL_NAME);
	return filtered.includes("read") ? filtered : ["read", ...filtered];
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

function renderCollapsedResult(
	result: { readonly details?: SubagentDetails },
	isPartial: boolean,
	theme: ToolResultTheme,
): Text {
	if (isPartial) return new Text(theme.fg("muted", "Agents are running in Herdr…"), 0, 0);
	const agents = result.details?.agents ?? [];
	const completed = agents.filter((agent) => agent.status === "completed").length;
	const failed = agents.filter((agent) => agent.status === "failed" || agent.status === "stopped").length;
	const summary = failed === 0 ? `${completed} completed` : `${completed} completed · ${failed} failed/stopped`;
	return new Text(theme.fg("toolOutput", `Agents · ${summary}`), 0, 0);
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
		model: agent.model ?? params.model,
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
	return [{
		task: params.task,
		allowedTools: sanitizeTools(params.allowedTools),
		includeSkills: params.includeSkills ?? true,
		includeExtensions: params.includeExtensions ?? true,
		includeContextFiles: params.includeContextFiles ?? false,
		model: params.model,
		thinkingLevel: params.thinkingLevel ?? "medium",
	}];
}

function createRecord(request: AgentRequest, cwd: string): SubagentRecord {
	const id = randomUUID();
	const now = Date.now();
	const sessionManager = SessionManager.create(cwd);
	sessionManager.appendSessionInfo(`Subagent: ${truncateTask(request.task)}`);
	const sessionFile = sessionManager.getSessionFile();
	if (sessionFile === undefined) {
		throw new Error("Could not create a persisted subagent session.");
	}
	return {
		...request,
		id,
		status: "queued",
		createdAt: now,
		updatedAt: now,
		sessionFile,
		sessionId: sessionManager.getSessionId(),
		resultFile: join(tmpdir(), `pi-subagent-${id}.result.json`),
		launchFile: join(tmpdir(), `pi-subagent-${id}.launch.sh`),
	};
}

function resolveSubagentModel(
	selection: string | undefined,
	ctx: ExtensionContext,
): NonNullable<ExtensionContext["model"]> {
	const subscriptionModels = ctx.modelRegistry
		.getAvailable()
		.filter((model) => ctx.modelRegistry.isUsingOAuth(model));
	const requestedId = selection ?? ctx.model?.id;

	if (requestedId === undefined) {
		throw new Error("Cannot choose a subagent model because the parent has no model.");
	}
	if (selection === undefined && ctx.model !== undefined && ctx.modelRegistry.isUsingOAuth(ctx.model)) {
		return ctx.model;
	}

	const exactMatches = subscriptionModels.filter(
		(model) => model.id === requestedId || `${model.provider}/${model.id}` === requestedId,
	);
	if (exactMatches.length === 1) {
		return exactMatches[0];
	}
	if (exactMatches.length > 1) {
		throw new Error(`Subscription model "${requestedId}" is ambiguous; use provider/model-id.`);
	}

	const resolved = resolveCliModel({ cliModel: requestedId, modelRegistry: ctx.modelRegistry });
	if (resolved.error !== undefined || resolved.model === undefined) {
		const reason = resolved.error === undefined ? "Model not found." : resolved.error;
		throw new Error(`Cannot resolve subagent model "${requestedId}": ${reason}`);
	}
	if (ctx.modelRegistry.isUsingOAuth(resolved.model)) {
		return resolved.model;
	}
	const subscriptionEquivalents = subscriptionModels.filter((model) => model.id === resolved.model?.id);
	return subscriptionEquivalents.length === 1 ? subscriptionEquivalents[0] : resolved.model;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function parseHerdrSurface(output: string): HerdrSurface {
	let envelope: unknown;
	try {
		envelope = JSON.parse(output);
	} catch {
		throw new Error(`Herdr returned malformed JSON: ${output}`);
	}
	if (!isRecord(envelope) || !isRecord(envelope.result)) {
		throw new Error("Herdr tab create returned no result.");
	}
	const tab = envelope.result.tab;
	const pane = envelope.result.root_pane ?? envelope.result.pane;
	if (!isRecord(tab) || typeof tab.tab_id !== "string") {
		throw new Error("Herdr tab create returned no tab id.");
	}
	if (!isRecord(pane) || typeof pane.pane_id !== "string") {
		throw new Error("Herdr tab create returned no pane id.");
	}
	return { tabId: tab.tab_id, paneId: pane.pane_id };
}

async function createHerdrSurface(pi: ExtensionAPI, record: SubagentRecord, cwd: string): Promise<HerdrSurface> {
	const label = `subagent: ${truncateTask(record.task)}`;
	const result = await pi.exec("herdr", ["tab", "create", "--cwd", cwd, "--label", label, "--no-focus"], {
		timeout: 5000,
	});
	if (result.code !== 0) {
		throw new Error(result.stderr || result.stdout || "Failed to create Herdr tab.");
	}
	return parseHerdrSurface(result.stdout);
}

async function closeHerdrTab(pi: ExtensionAPI, tabId: string | undefined): Promise<void> {
	if (tabId === undefined) {
		return;
	}
	await pi.exec("herdr", ["tab", "close", tabId], { timeout: 5000 });
}

function childCommand(record: SubagentRecord, model: NonNullable<ExtensionContext["model"]>): string {
	if (record.sessionFile === undefined || record.resultFile === undefined) {
		throw new Error("Subagent launch files were not initialized.");
	}

	const modelRef = `${model.provider}/${model.id}`;
	const args = [
		"pi",
		"--session", record.sessionFile,
		"--name", `Subagent: ${truncateTask(record.task)}`,
		"--model", modelRef,
		"--models", modelRef,
		"--thinking", record.thinkingLevel,
		"--tools", record.allowedTools.join(","),
		"--exclude-tools", TOOL_NAME,
	];
	if (!record.includeSkills) {
		args.push("--no-skills");
	}
	if (!record.includeContextFiles) {
		args.push("--no-context-files");
	}
	if (!record.includeExtensions) {
		args.push("--no-extensions", "--extension", fileURLToPath(import.meta.url));
	}
	args.push(record.task);

	const environment = [
		`${CHILD_ENV}=1`,
		`${CHILD_RESULT_FILE_ENV}=${shellQuote(record.resultFile)}`,
	];
	return `exec env ${environment.join(" ")} ${args.map(shellQuote).join(" ")}`;
}

function createChildLauncher(record: SubagentRecord, model: NonNullable<ExtensionContext["model"]>): string {
	if (record.launchFile === undefined) {
		throw new Error("Subagent launch file was not initialized.");
	}

	writeFileSync(record.launchFile, `#!/bin/sh\n${childCommand(record, model)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	return `/bin/sh ${shellQuote(record.launchFile)}`;
}

async function launchSubagent(
	pi: ExtensionAPI,
	record: SubagentRecord,
	ctx: ExtensionContext,
): Promise<SubagentRecord> {
	updateSubagent(record.id, { status: "starting" });
	const surface = await createHerdrSurface(pi, record, ctx.cwd);
	updateSubagent(record.id, { tabId: surface.tabId, paneId: surface.paneId });

	const model = resolveSubagentModel(record.model, ctx);
	updateSubagent(record.id, {
		modelRef: `${model.provider}/${model.id}`,
		contextWindow: model.contextWindow,
	});
	const command = createChildLauncher(record, model);
	const launched = await pi.exec("herdr", ["pane", "run", surface.paneId, command], { timeout: 5000 });
	if (launched.code !== 0) {
		await closeHerdrTab(pi, surface.tabId);
		throw new Error(launched.stderr || launched.stdout || "Failed to start subagent in Herdr.");
	}

	return updateSubagent(record.id, { status: "working" }) ?? record;
}

function parseChildResult(path: string): ChildResult | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) {
			return undefined;
		}
		if (parsed.status !== "completed" && parsed.status !== "failed" && parsed.status !== "stopped") {
			return undefined;
		}
		return {
			status: parsed.status,
			error: typeof parsed.error === "string" ? parsed.error : undefined,
		};
	} catch {
		return undefined;
	}
}

async function delay(signal: AbortSignal): Promise<void> {
	await new Promise<void>((resolve) => {
		const finish = () => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		};
		const timeout = setTimeout(finish, POLL_INTERVAL_MS);
		const onAbort = () => {
			clearTimeout(timeout);
			finish();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function waitForChild(pi: ExtensionAPI, record: SubagentRecord, signal: AbortSignal): Promise<ChildResult> {
	if (record.resultFile === undefined) {
		throw new Error("Subagent result file was not initialized.");
	}
	let pollCount = 0;
	while (!signal.aborted) {
		const result = parseChildResult(record.resultFile);
		if (result !== undefined) {
			return result;
		}
		if (record.tabId !== undefined && pollCount % 4 === 0) {
			const tab = await pi.exec("herdr", ["tab", "get", record.tabId], { timeout: 3000 });
			if (tab.code !== 0) {
				return { status: "stopped", error: "The Herdr tab was closed before the subagent completed." };
			}
		}
		pollCount += 1;
		await delay(signal);
	}
	return { status: "stopped", error: "Subagent cancelled." };
}

function readSubagentResult(record: SubagentRecord): string {
	if (record.sessionFile === undefined || !existsSync(record.sessionFile)) {
		return "";
	}
	try {
		const session = SessionManager.open(record.sessionFile);
		return finalResponseFromMessages(session.buildSessionContext().messages);
	} catch {
		return "";
	}
}

async function runExternalAgent(
	pi: ExtensionAPI,
	record: SubagentRecord,
	ctx: ExtensionContext,
	signal: AbortSignal,
	updateProgress: UpdateProgress,
	index: number,
	total: number,
): Promise<string> {
	updateProgress(index, "starting in Herdr");

	try {
		const launched = await launchSubagent(pi, record, ctx);
		updateProgress(index, "working");
		const childResult = await waitForChild(pi, launched, signal);
		const result = readSubagentResult(launched);
		if (childResult.status === "completed") {
			updateSubagent(record.id, { status: "completed", result });
			updateProgress(index, "completed");
			return result || `${agentLabel(index, total)} completed without a final text response.`;
		}

		const message = childResult.error ?? `Subagent ${childResult.status}.`;
		updateSubagent(record.id, { status: childResult.status, error: message, result });
		updateProgress(index, childResult.status);
		return result || `${agentLabel(index, total)} ${childResult.status}: ${message}`;
	} finally {
		await closeHerdrTab(pi, subagents.get(record.id)?.tabId);
		for (const path of [record.resultFile, record.launchFile]) {
			if (path !== undefined) rmSync(path, { force: true });
		}
	}
}

function statusDot(status: SubagentStatus, theme: SubagentTheme): string {
	if (status === "completed") return theme.fg("success", "●");
	if (status === "working" || status === "starting") return theme.fg("warning", "●");
	if (status === "failed") return theme.fg("error", "●");
	if (status === "stopped") return theme.fg("muted", "■");
	return " ";
}

function statusLabel(status: SubagentStatus): string {
	if (status === "completed") return "Done";
	if (status === "working" || status === "starting") return "Working";
	if (status === "failed") return "Failed";
	if (status === "stopped") return "Stopped";
	return "Not started";
}

function shortAge(timestamp: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h`;
}

function borderLine(left: string, fill: string, right: string, width: number): string {
	const inner = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
	return truncateToWidth(`${left}${fill.repeat(inner)}${right}`, width, "");
}

function isActive(status: SubagentStatus): boolean {
	return status === "queued" || status === "starting" || status === "working";
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
		if (selectedRecord === undefined) return;
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
		const modalWidth = Math.max(1, Math.min(width, 104));
		const innerWidth = Math.max(0, modalWidth - 4);
		const records = sortedSubagents();
		if (this.selected >= records.length) this.selected = Math.max(0, records.length - 1);
		const running = records.filter((record) => isActive(record.status)).length;
		const completed = records.filter((record) => record.status === "completed").length;
		const summary = `${running} running · ${completed} completed · ${records.length} total`;

		const lines = [
			this.theme.fg("accent", borderLine("╭─ Subagent Manager ", "─", "╮", modalWidth)),
			`│ ${truncateToWidth(`${this.theme.bold("Agents")} ${this.theme.fg("dim", `· ${summary}`)}`, innerWidth)} │`,
			`│ ${truncateToWidth(this.theme.fg("dim", "↑↓ navigate  •  Enter open/focus  •  x stop  •  Esc close  •  Alt+S toggle"), innerWidth)} │`,
			this.theme.fg("accent", borderLine("├", "─", "┤", modalWidth)),
		];
		if (records.length === 0) {
			lines.push(`│ ${truncateToWidth(this.theme.fg("muted", "No subagents yet."), innerWidth)} │`);
		} else {
			const start = Math.max(0, Math.min(this.selected - 2, records.length - 6));
			const end = Math.min(records.length, start + 6);
			for (let index = start; index < end; index += 1) {
				const record = records[index];
				if (record === undefined) continue;
				const selected = index === this.selected;
				const prefix = selected ? this.theme.fg("accent", "›") : " ";
				const label = selected ? this.theme.bold(statusLabel(record.status)) : statusLabel(record.status);
				const age = isActive(record.status) ? elapsed(record.createdAt) : shortAge(record.updatedAt);
				const model = record.modelRef === undefined ? "" : ` · ${record.modelRef}`;
				const activity = agentActivity(record);
				lines.push(`│ ${truncateToWidth(`${prefix} ${statusDot(record.status, this.theme)} ${label} ${this.theme.fg("dim", `· ${age}${model}`)}`, innerWidth)} │`);
				lines.push(`│ ${truncateToWidth(`${selected ? this.theme.fg("accent", "  └─") : "  └─"} ${this.theme.fg("muted", firstLine(record.task, 82))}`, innerWidth)} │`);
				if (selected) lines.push(`│ ${truncateToWidth(`     ${this.theme.fg("dim", activity.activity)}`, innerWidth)} │`);
			}
			if (records.length > 6) {
				lines.push(`│ ${truncateToWidth(this.theme.fg("dim", `  showing ${start + 1}–${end} of ${records.length}`), innerWidth)} │`);
			}
		}
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

function isThinkingLevel(value: string): value is ThinkingLevel {
	return THINKING_LEVELS.some((level) => level === value);
}

function restoreSubagents(ctx: ExtensionContext): void {
	subagents.clear();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== "subagent") continue;
		const data = entry.data;
		if (!isRecord(data) || typeof data.id !== "string" || typeof data.task !== "string") continue;
		const now = Date.now();
		const restoredStatus = data.status === "completed" || data.status === "failed" || data.status === "stopped"
			? data.status
			: "stopped";
		upsertSubagent({
			id: data.id,
			task: data.task,
			allowedTools: Array.isArray(data.allowedTools) ? data.allowedTools.filter((tool): tool is string => typeof tool === "string") : DEFAULT_TOOLS,
			includeSkills: typeof data.includeSkills === "boolean" ? data.includeSkills : true,
			includeExtensions: typeof data.includeExtensions === "boolean" ? data.includeExtensions : true,
			includeContextFiles: typeof data.includeContextFiles === "boolean" ? data.includeContextFiles : false,
			model: typeof data.model === "string" ? data.model : undefined,
			modelRef: typeof data.modelRef === "string" ? data.modelRef : undefined,
			contextWindow: typeof data.contextWindow === "number" ? data.contextWindow : undefined,
			thinkingLevel: typeof data.thinkingLevel === "string" && isThinkingLevel(data.thinkingLevel) ? data.thinkingLevel : "medium",
			status: restoredStatus,
			createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
			updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : now,
			sessionFile: typeof data.sessionFile === "string" ? data.sessionFile : undefined,
			sessionId: typeof data.sessionId === "string" ? data.sessionId : undefined,
			resultFile: typeof data.resultFile === "string" ? data.resultFile : undefined,
			launchFile: typeof data.launchFile === "string" ? data.launchFile : undefined,
			tabId: typeof data.tabId === "string" ? data.tabId : undefined,
			paneId: typeof data.paneId === "string" ? data.paneId : undefined,
			result: typeof data.result === "string" ? data.result : undefined,
			error: typeof data.error === "string" ? data.error : undefined,
		});
	}
}

async function openCompletedSession(pi: ExtensionAPI, record: SubagentRecord, cwd: string): Promise<void> {
	if (record.sessionFile === undefined) throw new Error("Subagent has no persisted session.");
	const surface = await createHerdrSurface(pi, record, cwd);
	const command = ["pi", "--session", record.sessionFile].map(shellQuote).join(" ");
	const result = await pi.exec("herdr", ["pane", "run", surface.paneId, command], { timeout: 5000 });
	if (result.code !== 0) {
		await closeHerdrTab(pi, surface.tabId);
		throw new Error(result.stderr || result.stdout || "Failed to open subagent session.");
	}
	await pi.exec("herdr", ["tab", "focus", surface.tabId], { timeout: 5000 });
}

export default function (pi: ExtensionAPI) {
	if (process.env[CHILD_ENV] === "1") {
		registerChildLifecycle(pi);
		return;
	}

	const persistSubagent = (record: SubagentRecord | undefined): void => {
		if (record !== undefined) pi.appendEntry("subagent", record);
	};

	pi.on("session_start", (_event, ctx) => {
		restoreSubagents(ctx);
		widgetContext = ctx;
	});

	pi.on("session_shutdown", () => {
		stopWidget();
		widgetContext = undefined;
	});

	const showSubagents = async (ctx: ExtensionContext): Promise<void> => {
		await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			return new SubagentsModal(
				theme,
				(record) => {
					void (async () => {
						if (isActive(record.status) && record.tabId !== undefined) {
							const focused = await pi.exec("herdr", ["tab", "focus", record.tabId], { timeout: 5000 });
							if (focused.code !== 0) throw new Error(focused.stderr || focused.stdout || "Failed to focus Herdr tab.");
						} else {
							await openCompletedSession(pi, record, ctx.cwd);
						}
						done(undefined);
					})().catch((error) => {
						ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
						tui.requestRender();
					});
				},
				(record) => {
					const controller = abortControllers.get(record.id);
					if (controller === undefined) {
						ctx.ui.notify("Only currently running subagents can be stopped.", "warning");
						return;
					}
					controller.abort();
					persistSubagent(updateSubagent(record.id, { status: "stopped" }));
					ctx.ui.notify(`Stopped ${truncateTask(record.task)}`, "info");
					tui.requestRender();
				},
				() => done(undefined),
				() => tui.requestRender(),
			);
		}, {
			overlay: true,
			overlayOptions: { width: "85%", maxHeight: "85%", anchor: "center", margin: 1 },
		});
	};

	pi.registerCommand("subagents", {
		description: "Open the subagent manager",
		handler: async (_args, ctx) => showSubagents(ctx),
	});

	pi.registerShortcut("alt+s", {
		description: "Open the subagent manager",
		handler: async (ctx) => showSubagents(ctx),
	});

	pi.registerTool<typeof schema, SubagentDetails>({
		name: TOOL_NAME,
		label: "Run Subagent",
		description:
			"Delegate one or more tasks to isolated Pi processes in unfocused Herdr tabs. Open /subagents to inspect, interrupt, or chat with a running child. Tabs close automatically after normal completion.",
		promptSnippet: "Delegate self-contained investigation, review, or research to isolated subagents",
		promptGuidelines: [
			"Use run_subagent when self-contained tasks can be delegated and only final answers are needed.",
			"Use agents to run multiple subagents in parallel; choose each agent's model and thinkingLevel based on task complexity.",
			"Pass the minimum allowedTools needed for the delegated task; run_subagent is always unavailable to subagents.",
		],
		parameters: schema,
		async execute(_toolCallId, params: SubagentInput, signal, onUpdate, ctx) {
			const records = buildRequests(params).map((request) => createRecord(request, ctx.cwd));
			for (const record of records) {
				upsertSubagent(record);
				persistSubagent(record);
			}
			startWidget(ctx);

			const total = records.length;
			const updateProgress = createProgressReporter(records, onUpdate);
			const results = await Promise.all(records.map(async (record, index) => {
				const controller = new AbortController();
				abortControllers.set(record.id, controller);
				if (signal !== undefined) signal.addEventListener("abort", () => controller.abort(), { once: true });
				try {
					const result = await runExternalAgent(pi, record, ctx, controller.signal, updateProgress, index + 1, total);
					persistSubagent(subagents.get(record.id));
					return result;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const status = controller.signal.aborted ? "stopped" : "failed";
					persistSubagent(updateSubagent(record.id, { status, error: message }));
					await closeHerdrTab(pi, subagents.get(record.id)?.tabId);
					return `${agentLabel(index + 1, total)} ${status}: ${message}`;
				} finally {
					abortControllers.delete(record.id);
				}
			}));

			const text = results.length === 1
				? results.join("")
				: results.map((result, index) => `## Subagent ${index + 1}/${total}\n\n${result}`).join("\n\n");
			const finalRecords = records.map((record) => subagents.get(record.id) ?? record);
			refreshWidget();
			return { content: [{ type: "text", text }], details: { agents: finalRecords } };
		},
		renderCall(params, theme) {
			return new Text(formatSubagentCall(params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded
				? renderExpandedResult(result, isPartial, theme)
				: renderCollapsedResult(result, isPartial, theme);
		},
	});
}
