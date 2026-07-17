export const TOOL_NAME = "run_subagent";
export const DEFAULT_TOOLS = ["read", "grep", "find", "ls"];
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type AgentRequest = {
	task: string;
	allowedTools: string[];
	includeSkills: boolean;
	includeExtensions: boolean;
	includeContextFiles: boolean;
	model?: string;
	thinkingLevel: ThinkingLevel;
};

export type SubagentStatus = "queued" | "starting" | "working" | "completed" | "failed" | "stopped";

export type SubagentRecord = AgentRequest & {
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
	terminalSurfaceId?: string;
	result?: string;
	error?: string;
	cleanupError?: string;
};

export type ChildResult =
	| { status: "completed" }
	| { status: "failed" | "stopped"; error: string };

export type SubagentDetails = { agents: SubagentRecord[] };
export type TextUpdate = { content: Array<{ type: "text"; text: string }>; details: SubagentDetails };
export type UpdateProgress = (index: number, text: string) => void;

export function isActive(status: SubagentStatus): boolean {
	return status === "queued" || status === "starting" || status === "working";
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
	return THINKING_LEVELS.some((level) => level === value);
}

export function statusLabel(status: SubagentStatus): string {
	if (status === "completed") return "Done";
	if (status === "working" || status === "starting") return "Working";
	if (status === "failed") return "Failed";
	if (status === "stopped") return "Stopped";
	return "Not started";
}

export function truncateTask(task: string): string {
	const singleLine = task.replace(/\s+/g, " ").trim();
	return singleLine.length > 80 ? `${singleLine.slice(0, 77)}…` : singleLine;
}

export function agentLabel(index: number, total: number): string {
	return total === 1 ? "Subagent" : `Subagent ${index}/${total}`;
}
