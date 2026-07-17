import { DefaultResourceLoader, InteractiveMode, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const AGENT_DIR = path.join(process.env.HOME ?? "", ".pi", "agent");
const CONFIG_PATH = path.join(AGENT_DIR, "context-file-policy.json");
const GLOBAL_AGENT_CONTEXT = path.join(AGENT_DIR, "AGENTS.md");
const OVERRIDES_DIR = path.join(AGENT_DIR, "context-file-overrides");

type ContextPolicy = {
	readonly allowedRepos: readonly string[];
	readonly ignoredRepos: readonly string[];
	readonly overriddenRepos: readonly string[];
};

type ContextPolicyDecision =
	| { readonly kind: "allowed"; readonly source: "default" | "explicit" }
	| { readonly kind: "ignored"; readonly source: "explicit" }
	| { readonly kind: "overridden"; readonly source: "explicit" };

type ContextFile = {
	readonly path: string;
	readonly content: string;
};

type ContextFileReplacement = {
	readonly original: ContextFile;
	readonly replacement: ContextFile;
};

type ContextFileActions = {
	readonly strippedFiles: readonly ContextFile[];
	readonly replacements: readonly ContextFileReplacement[];
	readonly injectedFile: ContextFile | undefined;
};

export default function contextFilePolicyExtension(pi: ExtensionAPI) {
	patchContextFileListing();

	let contextFileActionsForRequest: ContextFileActions = emptyContextFileActions();

	pi.on("before_agent_start", async (event, ctx) => {
		contextFileActionsForRequest = await findContextFileActions(event.systemPromptOptions.contextFiles ?? [], ctx.cwd);

		if (!hasContextFileActions(contextFileActionsForRequest)) return;

		return {
			systemPrompt: applyContextFileActionsToPrompt(event.systemPrompt, contextFileActionsForRequest),
		};
	});

	pi.on("before_provider_request", (event) => {
		if (!hasContextFileActions(contextFileActionsForRequest)) return;
		return applyContextFileActionsToPayload(event.payload, contextFileActionsForRequest);
	});

	pi.registerCommand("context-files", {
		description: "Toggle local AGENTS.md/CLAUDE.md loading. Usage: /context-files [status|allow|ignore|override|toggle]",
		handler: async (args, ctx) => {
			await handleCommand(args, ctx);
		},
	});
}

async function findContextFileActions(contextFiles: readonly ContextFile[], cwd: string): Promise<ContextFileActions> {
	const policy = await readPolicy();
	const policyRoot = findRepoRoot(cwd) ?? normalizePath(cwd);
	const decision = resolveContextPolicy(policyRoot, policy);
	const policyFiles = contextFiles.filter((file) => isPolicyContextFile({ path: normalizeContextFilePath(file.path, cwd), content: file.content }, policyRoot));

	if (decision.kind === "ignored") return { strippedFiles: policyFiles, replacements: [], injectedFile: undefined };
	if (decision.kind !== "overridden") return emptyContextFileActions();

	const overrideFile = await readOrCreateDefaultOverrideFile(policyRoot);
	return {
		strippedFiles: policyFiles,
		replacements: [],
		injectedFile: { path: overrideFile.path, content: overrideFile.content },
	};
}

function emptyContextFileActions(): ContextFileActions {
	return { strippedFiles: [], replacements: [], injectedFile: undefined };
}

function hasContextFileActions(actions: ContextFileActions): boolean {
	return actions.strippedFiles.length > 0 || actions.replacements.length > 0 || actions.injectedFile !== undefined;
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
	const policyRoot = cwd === undefined ? undefined : findRepoRoot(cwd);
	if (policyRoot === undefined) {
		return { agentsFiles: result.agentsFiles.filter((file) => shouldShowContextFile(file, policy, cwd)) };
	}

	const decision = resolveContextPolicy(policyRoot, policy);
	if (decision.kind !== "overridden") {
		return { agentsFiles: result.agentsFiles.filter((file) => shouldShowContextFile(file, policy, cwd)) };
	}

	const globalFiles = result.agentsFiles.filter((file) => normalizeContextFilePath(file.path, cwd) === normalizePath(GLOBAL_AGENT_CONTEXT));
	return { agentsFiles: [...globalFiles, readOrCreateDefaultOverrideFileSync(policyRoot)] };
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
	if (!isPolicyContextFile({ path: normalizedPath, content: file.content }, policyRoot)) return true;
	return resolveContextPolicy(policyRoot, policy).kind === "allowed";
}

function normalizeContextFilePath(filePath: string, cwd: string | undefined): string {
	if (path.isAbsolute(filePath)) return normalizePath(filePath);
	return normalizePath(path.join(cwd ?? process.cwd(), filePath));
}

async function handleCommand(args: string, ctx: ExtensionContext): Promise<void> {
	const commandArgs = parseCommandArgs(args);
	const command = commandArgs.command;
	const repoRoot = findRepoRoot(ctx.cwd) ?? normalizePath(ctx.cwd);
	const policy = await readPolicy();
	const decision = resolveContextPolicy(repoRoot, policy);

	if (command === "status") {
		const suffix = decision.source === "default" ? " by default" : "";
		ctx.ui.notify(`Local context files are ${decision.kind}${suffix} for ${repoRoot}.`, "info");
		return;
	}

	if (command === "toggle") {
		if (decision.kind === "allowed" || decision.kind === "overridden") {
			await writePolicy({
				allowedRepos: removeEntry(policy.allowedRepos, repoRoot),
				ignoredRepos: addUnique(policy.ignoredRepos, repoRoot),
				overriddenRepos: removeEntry(policy.overriddenRepos, repoRoot),
			});
			ctx.ui.notify(`Ignored local context files for ${repoRoot}.`, "info");
			return;
		}

		await writePolicy({
			allowedRepos: addUnique(policy.allowedRepos, repoRoot),
			ignoredRepos: removeEntry(policy.ignoredRepos, repoRoot),
			overriddenRepos: removeEntry(policy.overriddenRepos, repoRoot),
		});
		ctx.ui.notify(`Allowed local context files for ${repoRoot}.`, "info");
		return;
	}

	if (command === "allow") {
		await writePolicy({
			allowedRepos: addUnique(policy.allowedRepos, repoRoot),
			ignoredRepos: removeEntry(policy.ignoredRepos, repoRoot),
			overriddenRepos: removeEntry(policy.overriddenRepos, repoRoot),
		});
		ctx.ui.notify(`Allowed local context files for ${repoRoot}.`, "info");
		return;
	}

	if (command === "ignore") {
		await writePolicy({
			allowedRepos: removeEntry(policy.allowedRepos, repoRoot),
			ignoredRepos: addUnique(policy.ignoredRepos, repoRoot),
			overriddenRepos: removeEntry(policy.overriddenRepos, repoRoot),
		});
		ctx.ui.notify(`Ignored local context files for ${repoRoot}.`, "info");
		return;
	}

	if (command === "override") {
		const overrideFile = await readOrCreateDefaultOverrideFile(repoRoot);
		await writePolicy({
			allowedRepos: removeEntry(policy.allowedRepos, repoRoot),
			ignoredRepos: removeEntry(policy.ignoredRepos, repoRoot),
			overriddenRepos: addUnique(policy.overriddenRepos, repoRoot),
		});

		const prefix = overrideFile.created ? "Created override file and enabled" : "Enabled";
		ctx.ui.notify(`${prefix} context override for ${repoRoot}: ${overrideFile.path}.`, "info");
		return;
	}

	ctx.ui.notify("Usage: /context-files [status|allow|ignore|override|toggle]", "warning");
}

type CommandArgs = {
	readonly command: string;
	readonly value: string | undefined;
};

function parseCommandArgs(args: string): CommandArgs {
	const trimmedArgs = args.trim();
	if (trimmedArgs === "") return { command: "toggle", value: undefined };

	const separatorIndex = trimmedArgs.search(/\s/);
	if (separatorIndex < 0) return { command: trimmedArgs, value: undefined };

	return {
		command: trimmedArgs.slice(0, separatorIndex),
		value: trimmedArgs.slice(separatorIndex).trim() || undefined,
	};
}

function getDefaultOverridePath(repoRoot: string): string {
	return path.join(OVERRIDES_DIR, `${getRepoName(repoRoot)}.md`);
}

type OverrideFile = {
	readonly path: string;
	readonly content: string;
	readonly created: boolean;
};

async function readOrCreateDefaultOverrideFile(repoRoot: string): Promise<OverrideFile> {
	const overridePath = getDefaultOverridePath(repoRoot);
	if (existsSync(overridePath)) {
		return { path: overridePath, content: await readFile(overridePath, "utf8"), created: false };
	}

	const seedContent = await readSeedContextFile(repoRoot);
	await mkdir(path.dirname(overridePath), { recursive: true });
	await writeFile(overridePath, seedContent, "utf8");
	return { path: overridePath, content: seedContent, created: true };
}

function readOrCreateDefaultOverrideFileSync(repoRoot: string): OverrideFile {
	const overridePath = getDefaultOverridePath(repoRoot);
	if (existsSync(overridePath)) {
		return { path: overridePath, content: readFileSync(overridePath, "utf8"), created: false };
	}

	const seedContent = readSeedContextFileSync(repoRoot);
	mkdirSync(path.dirname(overridePath), { recursive: true });
	writeFileSync(overridePath, seedContent, "utf8");
	return { path: overridePath, content: seedContent, created: true };
}

async function readSeedContextFile(repoRoot: string): Promise<string> {
	const repoAgentsPath = path.join(repoRoot, "AGENTS.md");
	if (!existsSync(repoAgentsPath)) return "";
	return readFile(repoAgentsPath, "utf8");
}

function readSeedContextFileSync(repoRoot: string): string {
	const repoAgentsPath = path.join(repoRoot, "AGENTS.md");
	if (!existsSync(repoAgentsPath)) return "";
	return readFileSync(repoAgentsPath, "utf8");
}

function shouldIgnoreContextFile(file: ContextFile, policyRoot: string, policy: ContextPolicy): boolean {
	return isPolicyContextFile(file, policyRoot) && resolveContextPolicy(policyRoot, policy).kind === "ignored";
}

function isPolicyContextFile(file: ContextFile, policyRoot: string): boolean {
	if (normalizePath(file.path) === normalizePath(GLOBAL_AGENT_CONTEXT)) return false;
	return isPathInside(file.path, policyRoot);
}

function applyContextFileActionsToPrompt(prompt: string, actions: ContextFileActions): string {
	const withReplacements = actions.replacements.reduce(replaceContextFile, prompt);
	const withoutStrippedFiles = actions.strippedFiles.reduce(stripContextFile, withReplacements);
	const withInjectedFile = actions.injectedFile === undefined ? withoutStrippedFiles : injectContextFile(withoutStrippedFiles, actions.injectedFile);
	return stripEmptyProjectContext(withInjectedFile);
}

function injectContextFile(prompt: string, file: ContextFile): string {
	if (prompt.includes(`path="${file.path}"`) || prompt.includes(file.content)) return prompt;

	const block = `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n`;
	const projectContextEnd = "</project_context>";
	const projectContextEndIndex = prompt.indexOf(projectContextEnd);
	if (projectContextEndIndex >= 0) return `${prompt.slice(0, projectContextEndIndex)}${block}\n${prompt.slice(projectContextEndIndex)}`;

	return `${prompt}\n<project_context>\n\nProject-specific instructions and guidelines:\n\n${block}\n</project_context>\n`;
}

function replaceContextFile(prompt: string, replacement: ContextFileReplacement): string {
	const exactBlock = `<project_instructions path="${replacement.original.path}">\n${replacement.original.content}\n</project_instructions>\n\n`;
	const replacementBlock = `<project_instructions path="${replacement.replacement.path}">\n${replacement.replacement.content}\n</project_instructions>\n\n`;
	const withExactBlock = prompt.replace(exactBlock, replacementBlock);
	if (withExactBlock !== prompt) return withExactBlock;

	return replaceContextFileByScanning(withExactBlock, replacement);
}

function replaceContextFileByScanning(prompt: string, replacement: ContextFileReplacement): string {
	return transformContextFileByScanning(prompt, replacement.original, replacement.replacement);
}

function stripContextFile(prompt: string, file: ContextFile): string {
	const exactBlock = `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`;
	const withoutExactBlock = prompt.replace(exactBlock, "");
	if (withoutExactBlock !== prompt) return withoutExactBlock;

	return stripContextFileByScanning(withoutExactBlock, file);
}

function stripContextFileByScanning(prompt: string, file: ContextFile): string {
	return transformContextFileByScanning(prompt, file, undefined);
}

function transformContextFileByScanning(prompt: string, original: ContextFile, replacement: ContextFile | undefined): string {
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
		const shouldTransform = openLine.includes(`path="${original.path}"`) || content === original.content;

		if (shouldTransform && replacement !== undefined) {
			result += `${before}<project_instructions path="${replacement.path}">\n${replacement.content}\n</project_instructions>\n\n`;
		} else {
			result += shouldTransform ? before : remaining.slice(0, blockEnd);
		}

		remaining = remaining.slice(blockEnd);
	}
}

function stripEmptyProjectContext(prompt: string): string {
	const emptyBlock = "<project_context>\n\nProject-specific instructions and guidelines:\n\n</project_context>\n";
	return prompt.replace(emptyBlock, "");
}

function applyContextFileActionsToPayload(payload: unknown, actions: ContextFileActions): unknown {
	if (typeof payload === "string") return applyContextFileActionsToPayloadString(payload, actions);
	if (Array.isArray(payload)) return payload.map((item) => applyContextFileActionsToPayload(item, actions));
	if (!isRecord(payload)) return payload;

	return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, applyContextFileActionsToPayload(value, actions)]));
}

function applyContextFileActionsToPayloadString(value: string, actions: ContextFileActions): string {
	if (!value.includes("<project_context>") && !value.includes("<project_instructions")) return value;
	return applyContextFileActionsToPrompt(value, actions);
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
		overriddenRepos: parseRepoList(value.overriddenRepos),
	};
}

function parseRepoList(value: unknown): readonly string[] {
	return Array.isArray(value) ? value.filter(isString).map(normalizePath) : [];
}

function emptyPolicy(): ContextPolicy {
	return { allowedRepos: [], ignoredRepos: [], overriddenRepos: [] };
}

function resolveContextPolicy(repoRoot: string, policy: ContextPolicy): ContextPolicyDecision {
	if (hasRepoEntry(policy.ignoredRepos, repoRoot)) return { kind: "ignored", source: "explicit" };
	if (hasRepoEntry(policy.overriddenRepos, repoRoot)) return { kind: "overridden", source: "explicit" };
	if (hasRepoEntry(policy.allowedRepos, repoRoot)) return { kind: "allowed", source: "explicit" };
	return { kind: "allowed", source: "default" };
}

function hasRepoEntry(values: readonly string[], repoRoot: string): boolean {
	const repoIdentity = getRepoIdentity(repoRoot);
	const matchingName = values.some((entry) => getRepoIdentity(entry) === repoIdentity);
	if (matchingName) return true;

	const normalizedRepoRoot = normalizePath(repoRoot);
	return values.includes(normalizedRepoRoot);
}

function getRepoIdentity(repoRoot: string): string {
	return getRepoName(repoRoot).toLowerCase();
}

function getRepoName(repoRoot: string): string {
	const remoteName = readGitRemoteName(repoRoot);
	return remoteName ?? path.basename(normalizePath(repoRoot));
}

function readGitRemoteName(repoRoot: string): string | undefined {
	const gitPath = path.join(normalizePath(repoRoot), ".git");
	let configPath = path.join(gitPath, "config");

	try {
		const gitFile = readFileSync(gitPath, "utf8").trim();
		const prefix = "gitdir:";
		if (gitFile.startsWith(prefix)) {
			const gitDir = gitFile.slice(prefix.length).trim();
			configPath = path.join(path.resolve(repoRoot, gitDir), "config");
		}
	} catch {
		// A regular clone has a .git directory rather than a gitdir file.
	}

	try {
		const config = readFileSync(configPath, "utf8");
		let isOriginSection = false;

		for (const line of config.split("\n")) {
			const trimmedLine = line.trim();
			if (trimmedLine.startsWith("[")) {
				isOriginSection = trimmedLine === '[remote "origin"]';
				continue;
			}
			if (!isOriginSection) continue;

			const remoteUrl = trimmedLine.match(/^url\s*=\s*(.+)$/)?.[1]?.trim();
			if (remoteUrl === undefined) continue;

			const remotePath = remoteUrl.replace(/[\\/]$/, "");
			const lastSeparator = Math.max(remotePath.lastIndexOf("/"), remotePath.lastIndexOf(":"));
			const name = remotePath.slice(lastSeparator + 1).replace(/\.git$/, "");
			return name || undefined;
		}

		return undefined;
	} catch {
		return undefined;
	}
}

function addUnique(values: readonly string[], value: string): readonly string[] {
	const normalizedValue = normalizePath(value);
	return values.includes(normalizedValue) ? values : [...values, normalizedValue];
}

function removeEntry(values: readonly string[], value: string): readonly string[] {
	const repoIdentity = getRepoIdentity(value);
	return values.filter((entry) => getRepoIdentity(entry) !== repoIdentity && normalizePath(entry) !== normalizePath(value));
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
