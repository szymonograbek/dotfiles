import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_PATH = path.join(process.env.HOME ?? "", ".pi", "agent", "context-file-policy.json");
const GLOBAL_AGENT_CONTEXT = path.join(process.env.HOME ?? "", ".pi", "agent", "AGENTS.md");

type ContextPolicy = {
	readonly allowedRepos: readonly string[];
	readonly ignoredRepos: readonly string[];
};

type ContextPolicyDecision =
	| { readonly kind: "allowed"; readonly source: "default" | "explicit" }
	| { readonly kind: "ignored"; readonly source: "explicit" };

export default function systemPromptExtension(pi: ExtensionAPI) {
	let lastEffectiveSystemPrompt: string | undefined;

	pi.on("before_agent_start", (event) => {
		lastEffectiveSystemPrompt = event.systemPrompt;
	});

	pi.registerCommand("system-prompt", {
		description: "Inspect the current system prompt. Usage: /system-prompt [copy|base]",
		handler: async (args, ctx) => {
			await handleSystemPromptCommand(args, ctx, lastEffectiveSystemPrompt);
		},
	});
}

async function handleSystemPromptCommand(args: string, ctx: ExtensionCommandContext, lastEffectiveSystemPrompt: string | undefined): Promise<void> {
	const command = args.trim() || "open";
	const rawSystemPrompt = command === "base" ? ctx.getSystemPrompt() : lastEffectiveSystemPrompt ?? ctx.getSystemPrompt();
	const systemPrompt = command === "base" ? rawSystemPrompt : await stripIgnoredLocalContext(rawSystemPrompt, ctx.cwd);

	if (command === "open") {
		await ctx.ui.editor("System Prompt", systemPrompt);
		return;
	}

	if (command === "copy") {
		await copyToClipboard(systemPrompt);
		ctx.ui.notify("Copied system prompt.", "info");
		return;
	}

	ctx.ui.notify("Usage: /system-prompt [copy|base]", "warning");
}

async function stripIgnoredLocalContext(prompt: string, cwd: string): Promise<string> {
	const policyRoot = findRepoRoot(cwd) ?? normalizePath(cwd);
	const policy = await readPolicy();
	if (resolveContextPolicy(policyRoot, policy).kind === "allowed") return prompt;

	return stripProjectInstructions(prompt, policyRoot);
}

function stripProjectInstructions(prompt: string, repoRoot: string): string {
	const withoutInstructions = stripProjectInstructionsByScanning(prompt, repoRoot);
	return withoutInstructions.replace("<project_context>\n\nProject-specific instructions and guidelines:\n\n</project_context>\n", "");
}

function stripProjectInstructionsByScanning(prompt: string, repoRoot: string): string {
	const openTag = "<project_instructions";
	const closeTag = "</project_instructions>";
	let remaining = prompt;
	let result = "";

	while (true) {
		const openStart = remaining.indexOf(openTag);
		if (openStart < 0) return result + remaining;

		const openEnd = remaining.indexOf(">\n", openStart);
		if (openEnd < 0) return result + remaining;

		const closeStart = remaining.indexOf(`\n${closeTag}`, openEnd);
		if (closeStart < 0) return result + remaining;

		const closeEnd = closeStart + closeTag.length + 1;
		const blockEnd = remaining.slice(closeEnd, closeEnd + 2) === "\n\n" ? closeEnd + 2 : closeEnd;
		const before = remaining.slice(0, openStart);
		const openLine = remaining.slice(openStart, openEnd + 1);
		const instructionPath = readInstructionPath(openLine);
		const shouldStrip = instructionPath !== undefined && normalizePath(instructionPath) !== normalizePath(GLOBAL_AGENT_CONTEXT) && isPathInside(instructionPath, repoRoot);

		result += shouldStrip ? before : remaining.slice(0, blockEnd);
		remaining = remaining.slice(blockEnd);
	}
}

function readInstructionPath(openLine: string): string | undefined {
	const prefix = 'path="';
	const start = openLine.indexOf(prefix);
	if (start < 0) return undefined;
	const valueStart = start + prefix.length;
	const valueEnd = openLine.indexOf('"', valueStart);
	return valueEnd < 0 ? undefined : openLine.slice(valueStart, valueEnd);
}

function findRepoRoot(startDir: string): string | undefined {
	let current = path.resolve(startDir);

	while (true) {
		if (existsSync(path.join(current, ".jj")) || existsSync(path.join(current, ".git"))) return current;

		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

async function readPolicy(): Promise<ContextPolicy> {
	try {
		return parsePolicy(JSON.parse(await readFile(CONFIG_PATH, "utf8")));
	} catch {
		return emptyPolicy();
	}
}

function parsePolicy(value: unknown): ContextPolicy {
	if (!isRecord(value)) return emptyPolicy();
	return {
		allowedRepos: parseRepoList(value.allowedRepos),
		ignoredRepos: parseRepoList(value.ignoredRepos),
	};
}

function parseRepoList(value: unknown): readonly string[] {
	return Array.isArray(value) ? value.filter(isString).map(normalizePath) : [];
}

function emptyPolicy(): ContextPolicy {
	return { allowedRepos: [], ignoredRepos: [] };
}

function resolveContextPolicy(repoRoot: string, policy: ContextPolicy): ContextPolicyDecision {
	const normalizedRepoRoot = normalizePath(repoRoot);
	if (policy.ignoredRepos.includes(normalizedRepoRoot)) return { kind: "ignored", source: "explicit" };
	if (policy.allowedRepos.includes(normalizedRepoRoot)) return { kind: "allowed", source: "explicit" };
	return { kind: "allowed", source: "default" };
}

function isPathInside(candidate: string, parent: string): boolean {
	const relative = path.relative(normalizePath(parent), normalizePath(candidate));
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizePath(value: string): string {
	return path.resolve(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
