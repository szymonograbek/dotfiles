import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, writeFileSync } from "node:fs";
import type { ChildResult } from "./domain.ts";

export const CHILD_ENV = "PI_RUN_SUBAGENT_CHILD";
export const CHILD_OUTCOME_FILE_ENV = "PI_RUN_SUBAGENT_OUTCOME_FILE";

function writeChildOutcome(result: ChildResult): void {
	const path = process.env[CHILD_OUTCOME_FILE_ENV];
	if (path === undefined || existsSync(path)) return;
	writeFileSync(path, JSON.stringify(result), "utf8");
}

export function registerChildLifecycle(pi: ExtensionAPI): void {
	let agentStarted = false;
	let operatorRevision = 0;
	let assistantRevision = 0;
	let awaitingOperatorResponse = false;
	let lastStopReason = "";
	let lastError = "";

	pi.on("agent_start", () => {
		agentStarted = true;
	});
	pi.on("input", (event) => {
		if (!agentStarted || event.source === "extension") return;
		operatorRevision += 1;
		awaitingOperatorResponse = true;
	});
	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") assistantRevision = operatorRevision;
	});
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		lastStopReason = event.message.stopReason;
		lastError = event.message.errorMessage ?? "";
		if (lastStopReason !== "aborted" && assistantRevision === operatorRevision) {
			awaitingOperatorResponse = false;
		}
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (lastStopReason === "aborted" || awaitingOperatorResponse) return;
		if (lastStopReason === "error") {
			writeChildOutcome({ status: "failed", error: lastError || "Subagent model request failed." });
		} else {
			writeChildOutcome({ status: "completed" });
		}
		ctx.shutdown();
	});
	pi.on("session_shutdown", () => writeChildOutcome({ status: "stopped", error: "Subagent session stopped." }));
}
