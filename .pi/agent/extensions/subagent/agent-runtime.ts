import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { CHILD_ENV, CHILD_OUTCOME_FILE_ENV } from "./child-runtime.ts";
import { TOOL_NAME, truncateTask, type AgentRequest, type ChildResult, type SubagentRecord } from "./domain.ts";
import type { ProcessCommand } from "./terminal/terminal-host.ts";
import { finalResponseFromMessages } from "./validation.ts";

const ChildResultSchema = Type.Union([
	Type.Object({ status: Type.Literal("completed") }),
	Type.Object({
		status: Type.Union([Type.Literal("failed"), Type.Literal("stopped")]),
		error: Type.String(),
	}),
]);

export function createRecord(request: AgentRequest, cwd: string): SubagentRecord {
	const id = randomUUID();
	const now = Date.now();
	const sessionManager = SessionManager.create(cwd);
	sessionManager.appendSessionInfo(`Subagent: ${truncateTask(request.task)}`);
	const sessionFile = sessionManager.getSessionFile();
	if (sessionFile === undefined) throw new Error("Could not create a persisted subagent session.");
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

export function resolveSubagentModel(selection: string | undefined, ctx: ExtensionContext): NonNullable<ExtensionContext["model"]> {
	const requestedId = selection ?? ctx.model?.id;
	if (requestedId === undefined) throw new Error("Cannot choose a subagent model because the parent has no model.");
	if (selection === undefined && ctx.model !== undefined && ctx.modelRegistry.isUsingOAuth(ctx.model)) return ctx.model;

	const matches = ctx.modelRegistry.getAll().filter(
		(model) => model.id === requestedId || `${model.provider}/${model.id}` === requestedId,
	);
	const subscriptionMatches = matches.filter((model) => ctx.modelRegistry.isUsingOAuth(model));
	if (subscriptionMatches.length === 1) return subscriptionMatches[0];
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) throw new Error(`Model "${requestedId}" is ambiguous; use provider/model-id.`);
	throw new Error(`Cannot resolve subagent model "${requestedId}": Model not found.`);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function createChildLauncher(
	record: SubagentRecord,
	model: NonNullable<ExtensionContext["model"]>,
	extensionUrl: string,
): ProcessCommand {
	if (record.sessionFile === undefined || record.resultFile === undefined || record.launchFile === undefined) {
		throw new Error("Subagent launch files were not initialized.");
	}
	const modelRef = `${model.provider}/${model.id}`;
	const args = [
		"pi", "--session", record.sessionFile, "--name", `Subagent: ${truncateTask(record.task)}`,
		"--model", modelRef, "--models", modelRef, "--thinking", record.thinkingLevel,
		"--tools", record.allowedTools.join(","), "--exclude-tools", TOOL_NAME,
	];
	if (!record.includeSkills) args.push("--no-skills");
	if (!record.includeContextFiles) args.push("--no-context-files");
	if (!record.includeExtensions) args.push("--no-extensions", "--extension", fileURLToPath(extensionUrl));
	args.push(`Task:\n${record.task}`);
	const childOutcomeFile = `${record.resultFile}.child`;
	const environment = [
		`${CHILD_ENV}=1`,
		`${CHILD_OUTCOME_FILE_ENV}=${shellQuote(childOutcomeFile)}`,
	];
	const command = `env ${environment.join(" ")} ${args.map(shellQuote).join(" ")}`;
	const fallbackResult = JSON.stringify({
		status: "failed",
		error: "Subagent process exited before reporting a result.",
	});
	const temporaryResultFile = `${record.resultFile}.tmp`;
	const script = [
		"#!/bin/sh",
		command,
		"exit_code=$?",
		`if [ ! -f ${shellQuote(record.resultFile)} ]; then`,
		"  umask 077",
		`  if [ -f ${shellQuote(childOutcomeFile)} ]; then`,
		`    mv ${shellQuote(childOutcomeFile)} ${shellQuote(record.resultFile)}`,
		"  else",
		`    printf '%s\\n' ${shellQuote(fallbackResult)} > ${shellQuote(temporaryResultFile)}`,
		`    mv ${shellQuote(temporaryResultFile)} ${shellQuote(record.resultFile)}`,
		"  fi",
		"fi",
		'exit "$exit_code"',
		"",
	].join("\n");
	writeFileSync(record.launchFile, script, { encoding: "utf8", mode: 0o600 });
	return { executable: "/bin/sh", args: [record.launchFile] };
}

export function artifactPaths(record: SubagentRecord): string[] {
	return [
		record.resultFile,
		record.resultFile === undefined ? undefined : `${record.resultFile}.child`,
		record.resultFile === undefined ? undefined : `${record.resultFile}.tmp`,
		record.launchFile,
	].filter((path): path is string => path !== undefined);
}

export function parseChildResult(path: string): ChildResult | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return Check(ChildResultSchema, parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function readSubagentResult(record: SubagentRecord): string {
	if (record.sessionFile === undefined || !existsSync(record.sessionFile)) return "";
	try {
		return finalResponseFromMessages(SessionManager.open(record.sessionFile).buildSessionContext().messages);
	} catch {
		return "";
	}
}

export function sessionCommand(record: SubagentRecord): ProcessCommand {
	if (record.sessionFile === undefined) throw new Error("Subagent has no persisted session.");
	return { executable: "pi", args: ["--session", record.sessionFile] };
}
