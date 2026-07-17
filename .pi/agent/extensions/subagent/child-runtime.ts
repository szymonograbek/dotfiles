import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, writeFileSync } from "node:fs";
import type { ChildResult } from "./domain.ts";

export const CHILD_ENV = "PI_RUN_SUBAGENT_CHILD";
export const CHILD_OUTCOME_FILE_ENV = "PI_RUN_SUBAGENT_OUTCOME_FILE";
export const CHILD_SIGNAL_FILE_ENV = "PI_RUN_SUBAGENT_SIGNAL_FILE";

function writeResult(path: string | undefined, result: ChildResult): void {
	if (path === undefined || existsSync(path)) return;
	writeFileSync(path, JSON.stringify(result), "utf8");
}

function writeChildOutcome(result: ChildResult): void {
	writeResult(process.env[CHILD_OUTCOME_FILE_ENV], result);
}

function detachFromParent(): void {
	writeResult(process.env[CHILD_SIGNAL_FILE_ENV], {
		status: "detached",
		error: "Operator took control of the subagent session.",
	});
}

export function registerChildLifecycle(pi: ExtensionAPI): void {
	let agentStarted = false;
	let operatorIntervened = false;
	let lastStopReason = "";
	let lastError = "";

	pi.on("agent_start", () => {
		agentStarted = true;
	});
	pi.on("input", (event) => {
		if (!agentStarted || event.source === "extension") return;
		operatorIntervened = true;
		detachFromParent();
	});
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		lastStopReason = event.message.stopReason;
		lastError = event.message.errorMessage ?? "";
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (lastStopReason === "aborted" || operatorIntervened) return;
		if (lastStopReason === "error") {
			writeChildOutcome({ status: "failed", error: lastError || "Subagent model request failed." });
		} else {
			writeChildOutcome({ status: "completed" });
		}
		ctx.shutdown();
	});
	pi.on("session_shutdown", () => writeChildOutcome({ status: "stopped", error: "Subagent session stopped." }));
}
