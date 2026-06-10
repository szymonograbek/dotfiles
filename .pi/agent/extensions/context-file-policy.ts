import { DefaultResourceLoader, InteractiveMode, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
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
	patchContextFileListing();

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

function patchContextFileListing(): void {
	patchResourceLoaderContextFiles();
	patchInteractiveModeContextFiles();
}

function patchResourceLoaderContextFiles(): void {
	if (!isPatchableResourceLoader(DefaultResourceLoader)) return;
	if (DefaultResourceLoader.prototype.getAgentsFiles.name === "getPolicyFilteredAgentsFiles") return;

	const originalGetAgentsFiles = DefaultResourceLoader.prototype.getAgentsFiles;
	DefaultResourceLoader.prototype.getAgentsFiles = function getPolicyFilteredAgentsFiles() {
		return filterAgentsFilesResult(originalGetAgentsFiles.call(this), getResourceLoaderCwd(this));
	};
}

function patchInteractiveModeContextFiles(): void {
	if (!isPatchableInteractiveMode(InteractiveMode)) return;
	if (InteractiveMode.prototype.showLoadedResources.name === "showPolicyFilteredLoadedResources") return;

	const originalShowLoadedResources = InteractiveMode.prototype.showLoadedResources;
	InteractiveMode.prototype.showLoadedResources = function showPolicyFilteredLoadedResources(options: unknown) {
		const resourceLoader = getInteractiveResourceLoader(this);
		if (resourceLoader === undefined) return originalShowLoadedResources.call(this, options);

		const originalGetAgentsFiles = resourceLoader.getAgentsFiles;
		resourceLoader.getAgentsFiles = function getPolicyFilteredAgentsFiles() {
			return filterAgentsFilesResult(originalGetAgentsFiles.call(this), getResourceLoaderCwd(this));
		};

		try {
			return originalShowLoadedResources.call(this, options);
		} finally {
			resourceLoader.getAgentsFiles = originalGetAgentsFiles;
		}
	};
}

function filterAgentsFilesResult(result: { readonly agentsFiles: readonly ContextFile[] }, cwd: string | undefined): { readonly agentsFiles: readonly ContextFile[] } {
	const policy = readPolicySync();
	return {
		agentsFiles: result.agentsFiles.filter((file) => shouldShowContextFile(file, policy, cwd)),
	};
}

function isPatchableResourceLoader(value: unknown): value is {
	readonly prototype: {
		getAgentsFiles: (this: unknown) => { agentsFiles: readonly ContextFile[] };
	};
} {
	if (!hasPrototype(value)) return false;
	const prototype = value.prototype;
	if (!isRecord(prototype)) return false;
	return typeof prototype.getAgentsFiles === "function";
}

function isPatchableInteractiveMode(value: unknown): value is {
	readonly prototype: {
		showLoadedResources: (this: unknown, options: unknown) => unknown;
	};
} {
	if (!hasPrototype(value)) return false;
	const prototype = value.prototype;
	if (!isRecord(prototype)) return false;
	return typeof prototype.showLoadedResources === "function";
}

function getInteractiveResourceLoader(value: unknown):
	| {
			getAgentsFiles: (this: unknown) => { agentsFiles: readonly ContextFile[] };
	  }
	| undefined {
	if (!isRecord(value)) return undefined;
	const session = value.session;
	if (!isRecord(session)) return undefined;
	const resourceLoader = session.resourceLoader;
	if (!isRecord(resourceLoader)) return undefined;
	return typeof resourceLoader.getAgentsFiles === "function" ? resourceLoader : undefined;
}

function getResourceLoaderCwd(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	return typeof value.cwd === "string" ? value.cwd : undefined;
}

function shouldShowContextFile(file: ContextFile, policy: ContextPolicy, cwd: string | undefined): boolean {
	const normalizedPath = normalizeContextFilePath(file.path, cwd);
	if (normalizedPath === normalizePath(GLOBAL_AGENT_CONTEXT)) return true;
	const policyRoot = findRepoRoot(path.dirname(normalizedPath)) ?? (cwd === undefined ? undefined : findRepoRoot(cwd));
	if (policyRoot === undefined) return true;
	return !shouldIgnoreContextFile({ path: normalizedPath, content: file.content }, policyRoot, policy);
}

function normalizeContextFilePath(filePath: string, cwd: string | undefined): string {
	if (path.isAbsolute(filePath)) return normalizePath(filePath);
	return normalizePath(path.join(cwd ?? process.cwd(), filePath));
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

function readPolicySync(): ContextPolicy {
	try {
		return parsePolicy(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
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

function hasPrototype(value: unknown): value is { readonly prototype: unknown } {
	return (typeof value === "object" || typeof value === "function") && value !== null && "prototype" in value;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
