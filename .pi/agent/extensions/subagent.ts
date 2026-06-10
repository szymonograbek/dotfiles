import { StringEnum } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
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
	thinkingLevel: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Default thinking level. Defaults to low." })),
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

type RunAgentArgs = AgentRequest & {
	index: number;
	total: number;
	cwd: string;
	signal: AbortSignal | undefined;
	onUpdate: ((update: { content: Array<{ type: "text"; text: string }> }) => void) | undefined;
};

function sanitizeTools(tools: string[] | undefined): string[] {
	return (tools ?? DEFAULT_TOOLS).filter((tool) => tool !== TOOL_NAME);
}

function latestStatus(index: number, total: number, toolName: string): string {
	const prefix = total === 1 ? "Subagent" : `Subagent ${index}/${total}`;
	return `${prefix} using ${toolName}…`;
}

function agentLabel(index: number, total: number): string {
	return total === 1 ? "Subagent" : `Subagent ${index}/${total}`;
}

function buildRequest(params: SubagentInput, agent: AgentInput): AgentRequest {
	return {
		task: agent.task,
		allowedTools: sanitizeTools(agent.allowedTools ?? params.allowedTools),
		includeSkills: agent.includeSkills ?? params.includeSkills ?? true,
		includeExtensions: agent.includeExtensions ?? params.includeExtensions ?? true,
		includeContextFiles: agent.includeContextFiles ?? params.includeContextFiles ?? false,
		thinkingLevel: agent.thinkingLevel ?? params.thinkingLevel ?? "low",
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
			thinkingLevel: params.thinkingLevel ?? "low",
		},
	];
}

async function runAgent(args: RunAgentArgs): Promise<string> {
	args.onUpdate?.({ content: [{ type: "text", text: `${agentLabel(args.index, args.total)} starting…` }] });

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
		tools: args.allowedTools,
		excludeTools: [TOOL_NAME],
		thinkingLevel: args.thinkingLevel,
	});

	let finalText = "";
	let currentAssistantText = "";
	const unsubscribe = session.subscribe((event) => {
		if (event.type === "message_start" && event.message.role === "assistant") {
			currentAssistantText = "";
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			currentAssistantText += event.assistantMessageEvent.delta;
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			finalText = currentAssistantText.trim();
		}
		if (event.type === "tool_execution_start") {
			args.onUpdate?.({ content: [{ type: "text", text: latestStatus(args.index, args.total, event.toolName) }] });
		}
	});

	const abort = () => {
		void session.abort();
	};
	args.signal?.addEventListener("abort", abort, { once: true });

	try {
		await session.prompt(args.task, { source: "extension" });
	} finally {
		args.signal?.removeEventListener("abort", abort);
		unsubscribe();
		session.dispose();
	}

	return finalText || `${agentLabel(args.index, args.total)} completed without a final text response.`;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
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
			const results = await Promise.all(
				requests.map((request, index) =>
					runAgent({ ...request, index: index + 1, total, cwd: ctx.cwd, signal, onUpdate }),
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
	});
}
