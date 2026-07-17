import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { DEFAULT_TOOLS, THINKING_LEVELS, TOOL_NAME, type AgentRequest } from "./domain.ts";

const MAX_AGENTS = 8;
const MAX_TOOLS = 32;

export const agentSchema = Type.Object({
	task: Type.String({ minLength: 1, description: "Self-contained task for the subagent." }),
	allowedTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: MAX_TOOLS, uniqueItems: true, description: "Tool names this subagent may use. run_subagent is always removed." })), 
	includeSkills: Type.Optional(Type.Boolean({ description: "Whether this subagent loads skills." })),
	includeExtensions: Type.Optional(Type.Boolean({ description: "Whether this subagent loads extensions." })),
	includeContextFiles: Type.Optional(Type.Boolean({ description: "Whether this subagent loads AGENTS.md and CLAUDE.md context files." })),
	model: Type.Optional(Type.String({ description: "Model for this subagent, such as gpt-5.6-sol. Subscription-backed variants are preferred." })),
	thinkingLevel: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Thinking level for this subagent." })),
});

export const subagentSchema = Type.Object({
	task: Type.Optional(Type.String({ minLength: 1, description: "Self-contained task for a single subagent." })),
	allowedTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: MAX_TOOLS, uniqueItems: true, description: "Default tool names subagents may use. run_subagent is always removed." })), 
	includeSkills: Type.Optional(Type.Boolean({ description: "Whether subagents load skills. Defaults to true." })),
	includeExtensions: Type.Optional(Type.Boolean({ description: "Whether subagents load extensions. Defaults to true." })),
	includeContextFiles: Type.Optional(Type.Boolean({ description: "Whether subagents load AGENTS.md and CLAUDE.md context files. Defaults to false." })),
	model: Type.Optional(Type.String({ description: "Default subagent model. Prefers the parent's subscription-backed equivalent when omitted." })),
	thinkingLevel: Type.Optional(StringEnum(THINKING_LEVELS, { description: "Default thinking level. Defaults to medium." })),
	agents: Type.Optional(Type.Array(agentSchema, { minItems: 1, maxItems: MAX_AGENTS, description: "Subagents to run in parallel. Each item may override allowedTools, includeSkills, includeExtensions, includeContextFiles, model, and thinkingLevel." })), 
});

export type SubagentInput = Static<typeof subagentSchema>;
type AgentInput = Static<typeof agentSchema>;

function sanitizeTools(tools: string[] | undefined): string[] {
	const normalized = (tools ?? DEFAULT_TOOLS).map((tool) => tool.trim()).filter((tool) => tool !== "" && tool !== TOOL_NAME);
	const unique = [...new Set(normalized)];
	return unique.includes("read") ? unique : ["read", ...unique];
}

function normalizeTask(task: string): string {
	const normalized = task.trim();
	if (normalized === "") throw new Error("Subagent tasks must not be empty.");
	return normalized;
}

function buildRequest(params: SubagentInput, agent: AgentInput): AgentRequest {
	return {
		task: normalizeTask(agent.task),
		allowedTools: sanitizeTools(agent.allowedTools ?? params.allowedTools),
		includeSkills: agent.includeSkills ?? params.includeSkills ?? true,
		includeExtensions: agent.includeExtensions ?? params.includeExtensions ?? true,
		includeContextFiles: agent.includeContextFiles ?? params.includeContextFiles ?? false,
		model: agent.model ?? params.model,
		thinkingLevel: agent.thinkingLevel ?? params.thinkingLevel ?? "medium",
	};
}

export function buildRequests(params: SubagentInput): AgentRequest[] {
	if (params.agents !== undefined && params.agents.length > 0) {
		return params.agents.map((agent) => buildRequest(params, agent));
	}
	if (params.task === undefined) {
		throw new Error("Provide either task for one subagent or agents for parallel subagents.");
	}
	return [{
		task: normalizeTask(params.task),
		allowedTools: sanitizeTools(params.allowedTools),
		includeSkills: params.includeSkills ?? true,
		includeExtensions: params.includeExtensions ?? true,
		includeContextFiles: params.includeContextFiles ?? false,
		model: params.model,
		thinkingLevel: params.thinkingLevel ?? "medium",
	}];
}
