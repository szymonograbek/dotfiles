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

const schema = Type.Object({
	task: Type.String({ description: "Self-contained task for the subagent." }),
	allowedTools: Type.Optional(
		Type.Array(Type.String(), {
			description: "Tool names the subagent may use. run_subagent is always removed.",
		}),
	),
	includeSkills: Type.Optional(Type.Boolean({ description: "Whether the subagent loads skills. Defaults to true." })),
	includeExtensions: Type.Optional(
		Type.Boolean({ description: "Whether the subagent loads extensions. Defaults to true." }),
	),
	includeContextFiles: Type.Optional(
		Type.Boolean({ description: "Whether the subagent loads AGENTS.md and CLAUDE.md context files. Defaults to false." }),
	),
	thinkingLevel: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Defaults to low." })),
});

type SubagentInput = Static<typeof schema>;

function sanitizeTools(tools: string[] | undefined): string[] {
	return (tools ?? DEFAULT_TOOLS).filter((tool) => tool !== TOOL_NAME);
}

function latestStatus(toolName: string): string {
	return `Subagent using ${toolName}…`;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Run Subagent",
		description:
			"Delegate a self-contained task to an isolated Pi subagent. The parent receives only terse progress and the subagent's final answer. The subagent never receives run_subagent.",
		promptSnippet: "Delegate self-contained investigation, review, or research to an isolated subagent",
		promptGuidelines: [
			"Use run_subagent when a self-contained task can be delegated and only the final answer is needed.",
			"Pass the minimum allowedTools needed for the delegated task; run_subagent is always unavailable to subagents.",
		],
		parameters: schema,
		async execute(_toolCallId, params: SubagentInput, signal, onUpdate, ctx) {
			const allowedTools = sanitizeTools(params.allowedTools);
			const includeSkills = params.includeSkills ?? true;
			const includeExtensions = params.includeExtensions ?? true;
			const includeContextFiles = params.includeContextFiles ?? false;
			const thinkingLevel = params.thinkingLevel ?? "low";

			onUpdate?.({ content: [{ type: "text", text: "Subagent starting…" }] });

			const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
			const loader = new DefaultResourceLoader({
				cwd: ctx.cwd,
				agentDir: getAgentDir(),
				settingsManager,
				noSkills: !includeSkills,
				noExtensions: !includeExtensions,
				noContextFiles: !includeContextFiles,
			});
			await loader.reload();

			const { session } = await createAgentSession({
				cwd: ctx.cwd,
				agentDir: getAgentDir(),
				resourceLoader: loader,
				settingsManager,
				sessionManager: SessionManager.inMemory(ctx.cwd),
				tools: allowedTools,
				excludeTools: [TOOL_NAME],
				thinkingLevel,
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
					onUpdate?.({ content: [{ type: "text", text: latestStatus(event.toolName) }] });
				}
			});

			const abort = () => {
				void session.abort();
			};
			signal?.addEventListener("abort", abort, { once: true });

			try {
				await session.prompt(params.task, { source: "extension" });
			} finally {
				signal?.removeEventListener("abort", abort);
				unsubscribe();
				session.dispose();
			}

			const text = finalText || "Subagent completed without a final text response.";
			return {
				content: [{ type: "text", text }],
				details: { allowedTools, includeSkills, includeExtensions, includeContextFiles, thinkingLevel },
			};
		},
	});
}
