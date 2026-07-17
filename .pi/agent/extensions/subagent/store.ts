import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_TOOLS, isThinkingLevel, type SubagentRecord } from "./domain.ts";
import { isRecord } from "./validation.ts";

export class SubagentStore {
	private readonly records = new Map<string, SubagentRecord>();
	private readonly controllers = new Map<string, AbortController>();

	upsert(record: SubagentRecord): void {
		this.records.set(record.id, record);
	}

	get(id: string): SubagentRecord | undefined {
		return this.records.get(id);
	}

	update(id: string, patch: Partial<SubagentRecord>): SubagentRecord | undefined {
		const current = this.records.get(id);
		if (current === undefined) return undefined;
		const next = { ...current, ...patch, updatedAt: Date.now() };
		this.records.set(id, next);
		return next;
	}

	sorted(): SubagentRecord[] {
		return [...this.records.values()].sort((left, right) => right.createdAt - left.createdAt);
	}

	setController(id: string, controller: AbortController): void {
		this.controllers.set(id, controller);
	}

	controller(id: string): AbortController | undefined {
		return this.controllers.get(id);
	}

	deleteController(id: string): void {
		this.controllers.delete(id);
	}

	abortAll(): void {
		for (const controller of this.controllers.values()) controller.abort();
	}

	restore(ctx: ExtensionContext): void {
		this.records.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== "subagent") continue;
			const data = entry.data;
			if (!isRecord(data) || typeof data.id !== "string" || typeof data.task !== "string") continue;
			const now = Date.now();
			const status = data.status === "completed" || data.status === "failed" || data.status === "stopped" ? data.status : "stopped";
			this.upsert({
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
				status,
				createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
				updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : now,
				sessionFile: typeof data.sessionFile === "string" ? data.sessionFile : undefined,
				sessionId: typeof data.sessionId === "string" ? data.sessionId : undefined,
				result: typeof data.result === "string" ? data.result : undefined,
				error: typeof data.error === "string" ? data.error : undefined,
				cleanupError: typeof data.cleanupError === "string" ? data.cleanupError : undefined,
			});
		}
	}
}
