import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

type ContextFile = {
	readonly path: string;
	readonly content: string;
};

export default function contextFilePolicyExtension(pi: ExtensionAPI) {
	let ignoredFilesForRequest: readonly ContextFile[] = [];

	pi.on("before_agent_start", async (event, ctx) => {
		ignoredFilesForRequest = await findIgnoredContextFiles(event.systemPromptOptions.contextFiles ?? [], ctx.cwd);

		if (ignoredFilesForRequest.length === 0) return;

		return {
			systemPrompt: stripContextFiles(event.systemPrompt, ignoredFilesForRequest),
		};
	});

	pi.on("before_provider_request", (event) => {
		if (ignoredFilesForRequest.length === 0) return;
		return stripContextFilesFromPayload(event.payload, ignoredFilesForRequest);
	});

	pi.registerCommand("context-files", {
		description: "Toggle local AGENTS.md/CLAUDE.md loading. Usage: /context-files [status|allow|ignore|toggle]",
		handler: async (args, ctx) => {
			await handleCommand(args, ctx);
		},
	});
}

async function findIgnoredContextFiles(contextFiles: readonly ContextFile[], cwd: string): Promise<readonly ContextFile[]> {
	const policy = await readPolicy();
	const policyRoot = findRepoRoot(cwd) ?? normalizePath(cwd);
	return contextFiles.filter((file) => shouldIgnoreContextFile(file, policyRoot, policy));
}

async function handleCommand(args: string, ctx: ExtensionContext): Promise<void> {
	const command = args.trim() || "toggle";
	const repoRoot = findRepoRoot(ctx.cwd) ?? normalizePath(ctx.cwd);
	const policy = await readPolicy();
	const decision = resolveContextPolicy(repoRoot, policy);

	if (command === "status") {
		const suffix = decision.source === "default" ? " by default" : "";
		ctx.ui.notify(`Local context files are ${decision.kind}${suffix} for ${repoRoot}.`, "info");
		return;
	}

	if (command === "toggle") {
		if (decision.kind === "allowed") {
			await writePolicy({
				allowedRepos: removeEntry(policy.allowedRepos, repoRoot),
				ignoredRepos: addUnique(policy.ignoredRepos, repoRoot),
			});
			ctx.ui.notify(`Ignored local context files for ${repoRoot}.`, "info");
			return;
		}

		await writePolicy({
			allowedRepos: addUnique(policy.allowedRepos, repoRoot),
			ignoredRepos: removeEntry(policy.ignoredRepos, repoRoot),
		});
		ctx.ui.notify(`Allowed local context files for ${repoRoot}.`, "info");
		return;
	}

	if (command === "allow") {
		await writePolicy({
			allowedRepos: addUnique(policy.allowedRepos, repoRoot),
			ignoredRepos: removeEntry(policy.ignoredRepos, repoRoot),
		});
		ctx.ui.notify(`Allowed local context files for ${repoRoot}.`, "info");
		return;
	}

	if (command === "ignore") {
		await writePolicy({
			allowedRepos: removeEntry(policy.allowedRepos, repoRoot),
			ignoredRepos: addUnique(policy.ignoredRepos, repoRoot),
		});
		ctx.ui.notify(`Ignored local context files for ${repoRoot}.`, "info");
		return;
	}

	ctx.ui.notify("Usage: /context-files [status|allow|ignore|toggle]", "warning");
}

function shouldIgnoreContextFile(file: ContextFile, policyRoot: string, policy: ContextPolicy): boolean {
	if (normalizePath(file.path) === normalizePath(GLOBAL_AGENT_CONTEXT)) return false;
	if (!isPathInside(file.path, policyRoot)) return false;
	return resolveContextPolicy(policyRoot, policy).kind === "ignored";
}

function stripContextFiles(prompt: string, files: readonly ContextFile[]): string {
	const withoutInstructions = files.reduce(stripContextFile, prompt);
	return stripEmptyProjectContext(withoutInstructions);
}

function stripContextFile(prompt: string, file: ContextFile): string {
	const exactBlock = `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`;
	const withoutExactBlock = prompt.replace(exactBlock, "");
	if (withoutExactBlock !== prompt) return withoutExactBlock;

	return stripContextFileByScanning(withoutExactBlock, file);
}

function stripContextFileByScanning(prompt: string, file: ContextFile): string {
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
		const content = remaining.slice(openEnd + 2, closeStart);
		const shouldStrip = openLine.includes(`path="${file.path}"`) || content === file.content;

		result += shouldStrip ? before : remaining.slice(0, blockEnd);
		remaining = remaining.slice(blockEnd);
	}
}

function stripEmptyProjectContext(prompt: string): string {
	const emptyBlock = "<project_context>\n\nProject-specific instructions and guidelines:\n\n</project_context>\n";
	return prompt.replace(emptyBlock, "");
}

function stripContextFilesFromPayload(payload: unknown, files: readonly ContextFile[]): unknown {
	if (typeof payload === "string") return stripContextFiles(payload, files);
	if (Array.isArray(payload)) return payload.map((item) => stripContextFilesFromPayload(item, files));
	if (!isRecord(payload)) return payload;

	return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, stripContextFilesFromPayload(value, files)]));
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

async function writePolicy(policy: ContextPolicy): Promise<void> {
	await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(policy, null, "\t")}\n`, "utf8");
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

function addUnique(values: readonly string[], value: string): readonly string[] {
	const normalizedValue = normalizePath(value);
	return values.includes(normalizedValue) ? values : [...values, normalizedValue];
}

function removeEntry(values: readonly string[], value: string): readonly string[] {
	const normalizedValue = normalizePath(value);
	return values.filter((entry) => entry !== normalizedValue);
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
