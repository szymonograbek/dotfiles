import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { rmSync } from "node:fs";
import { artifactPaths, createChildLauncher, parseChildResult, readSubagentResult, resolveSubagentModel, sessionCommand } from "./agent-runtime.ts";
import { agentLabel, truncateTask, type ChildResult, type SubagentRecord, type UpdateProgress } from "./domain.ts";
import type { SubagentStore } from "./store.ts";
import type { TerminalHost, TerminalSurfaceId } from "./terminal/terminal-host.ts";

const POLL_INTERVAL_MS = 500;

function delay(signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class SubagentOrchestrator {
	constructor(
		private readonly terminal: TerminalHost,
		private readonly store: SubagentStore,
		private readonly extensionUrl: string,
	) {}

	async run(
		record: SubagentRecord,
		ctx: ExtensionContext,
		signal: AbortSignal,
		updateProgress: UpdateProgress,
		index: number,
		total: number,
	): Promise<string> {
		updateProgress(index, "starting in terminal");
		signal.throwIfAborted();
		try {
			const launched = await this.launch(record, ctx, signal);
			updateProgress(index, "working");
			const childResult = await this.waitForChild(launched, signal);
			const result = readSubagentResult(launched);
			if (childResult.status === "completed") {
				this.store.update(record.id, { status: "completed", result });
				updateProgress(index, "completed");
				return result || `${agentLabel(index, total)} completed without a final text response.`;
			}

			this.store.update(record.id, { status: childResult.status, error: childResult.error, result });
			updateProgress(index, childResult.status);
			const summary = `${agentLabel(index, total)} ${childResult.status}: ${childResult.error}`;
			return result === "" ? summary : `${summary}\n\nPartial output:\n${result}`;
		} finally {
			const closed = await this.closeSurface(record.id, this.store.get(record.id)?.terminalSurfaceId);
			if (closed) this.removeArtifacts(record);
		}
	}

	async shutdown(): Promise<void> {
		this.store.abortAll();
		await this.terminal.closeAll();
		for (const record of this.store.sorted()) this.removeArtifacts(record);
	}

	async openSession(record: SubagentRecord, cwd: string): Promise<void> {
		const surfaceId = await this.terminal.createSurface({ cwd, label: `subagent: ${truncateTask(record.task)}`, focus: false });
		try {
			await this.terminal.start(surfaceId, sessionCommand(record));
			await this.terminal.focus(surfaceId);
		} catch (error) {
			await this.closeSurface(record.id, surfaceId);
			throw error;
		}
	}

	private async launch(record: SubagentRecord, ctx: ExtensionContext, signal: AbortSignal): Promise<SubagentRecord> {
		this.store.update(record.id, { status: "starting" });
		signal.throwIfAborted();
		let surfaceId: TerminalSurfaceId | undefined;
		try {
			surfaceId = await this.terminal.createSurface({
				cwd: ctx.cwd,
				label: `subagent: ${truncateTask(record.task)}`,
				focus: false,
			});
			this.store.update(record.id, { terminalSurfaceId: surfaceId });
			signal.throwIfAborted();
			const model = resolveSubagentModel(record.model, ctx);
			this.store.update(record.id, { modelRef: `${model.provider}/${model.id}`, contextWindow: model.contextWindow });
			await this.terminal.start(surfaceId, createChildLauncher(record, model, this.extensionUrl), signal);
			signal.throwIfAborted();
			return this.store.update(record.id, { status: "working" }) ?? record;
		} catch (error) {
			await this.closeSurface(record.id, surfaceId);
			throw error;
		}
	}

	private async waitForChild(record: SubagentRecord, signal: AbortSignal): Promise<ChildResult> {
		if (record.resultFile === undefined) throw new Error("Subagent result file was not initialized.");
		let pollCount = 0;
		while (!signal.aborted) {
			const result = parseChildResult(record.resultFile);
			if (result !== undefined) return result;
			if (record.terminalSurfaceId !== undefined && pollCount % 4 === 0) {
				const open = await this.terminal.isOpen(record.terminalSurfaceId, signal);
				if (!open) return { status: "stopped", error: "The terminal surface was closed before the subagent completed." };
			}
			pollCount += 1;
			await delay(signal);
		}
		return { status: "stopped", error: "Subagent cancelled." };
	}

	private async closeSurface(recordId: string, surfaceId: TerminalSurfaceId | undefined): Promise<boolean> {
		try {
			await this.terminal.close(surfaceId);
			return true;
		} catch (error) {
			this.store.update(recordId, { cleanupError: errorMessage(error) });
			return false;
		}
	}

	private removeArtifacts(record: SubagentRecord): void {
		for (const path of artifactPaths(record)) rmSync(path, { force: true });
	}
}
