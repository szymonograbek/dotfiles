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
import { Text } from "@earendil-works/pi-tui";
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

type SubagentDetails = { agents: AgentRequest[] };
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
	index: number;
	total: number;
	cwd: string;
	model: ExtensionContext["model"];
	signal: AbortSignal | undefined;
	updateProgress: UpdateProgress;
};

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
	requests: AgentRequest[],
	onUpdate: ((update: TextUpdate) => void) | undefined,
): UpdateProgress {
	const total = requests.length;
	const statuses = requests.map((request, index) => progressText(index + 1, total, "queued", request.task));

	return (index, text) => {
		statuses[index - 1] = progressText(index, total, text, requests[index - 1]?.task ?? "");
		onUpdate?.({ content: [{ type: "text", text: statuses.join("\n") }], details: { agents: requests } });
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

	const { session } = await createAgentSession({
		cwd: args.cwd,
		agentDir: getAgentDir(),
		resourceLoader: loader,
		settingsManager,
		sessionManager: SessionManager.inMemory(args.cwd),
		model: args.model,
		tools: args.allowedTools,
		excludeTools: [TOOL_NAME],
		thinkingLevel: args.thinkingLevel,
	});

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
			args.updateProgress(args.index, "thinking");
		}
		if (event.type === "tool_execution_start") {
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
		await session.prompt(args.task, { source: "extension" });
		finalText = finalText || finalResponseFromMessages(session.messages);
		args.updateProgress(args.index, "completed");
	} catch (error) {
		args.updateProgress(args.index, "failed");
		throw error;
	} finally {
		args.signal?.removeEventListener("abort", abort);
		unsubscribe();
		session.dispose();
	}

	return finalText || lastToolText || assistantError || `${agentLabel(args.index, args.total)} completed without a final text response.`;
}

export default function (pi: ExtensionAPI) {
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
			const requests = buildRequests(params);
			const total = requests.length;
			const updateProgress = createProgressReporter(requests, onUpdate);
			const results = await Promise.all(
				requests.map((request, index) =>
					runAgent({ ...request, index: index + 1, total, cwd: ctx.cwd, model: ctx.model, signal, updateProgress }),
				),
			);

			const text =
				results.length === 1
					? results.join("")
					: results.map((result, index) => `## Subagent ${index + 1}/${total}\n\n${result}`).join("\n\n");

			return {
				content: [{ type: "text", text }],
				details: { agents: requests },
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
