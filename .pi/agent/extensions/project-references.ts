import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";

const STORE_PATH = join(homedir(), ".pi", "agent", "project-references.json");
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const TOKEN_BOUNDARY_PATTERN = /(^|[\s"'(=])@([A-Za-z0-9._-]+)(\/[^\s"'.,;:!?)]*)?(?=$|[\s"'.,;:!?)])/g;

type ProjectReferences = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStore(value: unknown): ProjectReferences {
	if (!isRecord(value)) return {};
	const projects: ProjectReferences = {};
	for (const [name, path] of Object.entries(value)) {
		if (PROJECT_NAME_PATTERN.test(name) && typeof path === "string" && isAbsolute(path)) {
			projects[name] = path;
		}
	}
	return projects;
}

async function loadProjects(): Promise<ProjectReferences> {
	try {
		return parseStore(JSON.parse(await readFile(STORE_PATH, "utf-8")));
	} catch {
		return {};
	}
}

async function saveProjects(projects: ProjectReferences): Promise<void> {
	await mkdir(dirname(STORE_PATH), { recursive: true });
	await writeFile(STORE_PATH, `${JSON.stringify(sortProjects(projects), null, "\t")}\n`, "utf-8");
}

function sortProjects(projects: ProjectReferences): ProjectReferences {
	const sorted: ProjectReferences = {};
	for (const name of Object.keys(projects).sort((a, b) => a.localeCompare(b))) {
		sorted[name] = projects[name] ?? "";
	}
	return sorted;
}

function isWithinOrEqual(childPath: string, parentPath: string): boolean {
	return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

function splitArgs(args: string): string[] {
	return args.trim().split(/\s+/).filter(Boolean);
}

function validateProjectName(name: string): string | undefined {
	if (!name) return "Project name is required.";
	if (!PROJECT_NAME_PATTERN.test(name)) return "Project name may only contain letters, numbers, dots, underscores, and dashes.";
	return undefined;
}

async function resolveProjectPath(pathArg: string | undefined, cwd: string): Promise<string> {
	const candidate = pathArg ? resolve(cwd, pathArg.replace(/^~(?=$|\/)/, homedir())) : cwd;
	return realpath(candidate);
}

function projectItems(projects: ProjectReferences, prefix: string): AutocompleteItem[] {
	const normalizedPrefix = prefix.toLowerCase();
	return Object.entries(projects)
		.filter(([name]) => name.toLowerCase().startsWith(normalizedPrefix))
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, path]) => ({ value: `@${name}`, label: name, description: path }));
}

function extractProjectToken(line: string, cursorCol: number): string | undefined {
	const beforeCursor = line.slice(0, cursorCol);
	const tokenStart = Math.max(
		beforeCursor.lastIndexOf(" "),
		beforeCursor.lastIndexOf("\t"),
		beforeCursor.lastIndexOf("\""),
		beforeCursor.lastIndexOf("'"),
		beforeCursor.lastIndexOf("="),
	) + 1;
	const token = beforeCursor.slice(tokenStart);
	if (!token.startsWith("@")) return undefined;
	const body = token.slice(1);
	if (body && !/^[A-Za-z0-9._\/-]+$/.test(body)) return undefined;
	return token;
}

function splitProjectToken(token: string): { namePrefix: string; relativePrefix?: string } {
	const body = token.slice(1);
	const slashIndex = body.indexOf("/");
	if (slashIndex === -1) return { namePrefix: body };
	return { namePrefix: body.slice(0, slashIndex), relativePrefix: body.slice(slashIndex + 1) };
}

async function scopedProjectItems(projects: ProjectReferences, token: string): Promise<AutocompleteItem[]> {
	const { namePrefix, relativePrefix } = splitProjectToken(token);
	if (relativePrefix === undefined) return projectItems(projects, namePrefix);
	const projectPath = projects[namePrefix];
	if (projectPath === undefined) return [];
	const lastSlashIndex = relativePrefix.lastIndexOf("/");
	const relativeDir = lastSlashIndex === -1 ? "" : relativePrefix.slice(0, lastSlashIndex + 1);
	const entryPrefix = lastSlashIndex === -1 ? relativePrefix : relativePrefix.slice(lastSlashIndex + 1);
	const searchDir = resolve(projectPath, relativeDir);
	if (!isWithinOrEqual(searchDir, projectPath)) return [];
	try {
		const entries = await readdir(searchDir, { withFileTypes: true });
		const items: AutocompleteItem[] = [];
		for (const entry of entries) {
			if (!entry.name.toLowerCase().startsWith(entryPrefix.toLowerCase())) continue;
			const absolutePath = join(searchDir, entry.name);
			const isDirectory = entry.isDirectory() || (!entry.isFile() && (await stat(absolutePath).catch(() => undefined))?.isDirectory() === true);
			const relativePath = `${relativeDir}${entry.name}${isDirectory ? "/" : ""}`;
			items.push({ value: `@${namePrefix}/${relativePath}`, label: `${entry.name}${isDirectory ? "/" : ""}`, description: absolutePath });
		}
		return items.sort((left, right) => {
			const leftDirectory = left.label.endsWith("/");
			const rightDirectory = right.label.endsWith("/");
			if (leftDirectory && !rightDirectory) return -1;
			if (!leftDirectory && rightDirectory) return 1;
			return left.label.localeCompare(right.label);
		});
	} catch {
		return [];
	}
}

function applyProjectCompletion(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	item: AutocompleteItem,
	prefix: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
	const currentLine = lines[cursorLine] ?? "";
	const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
	const afterCursor = currentLine.slice(cursorCol);
	const suffix = afterCursor.startsWith(" ") || afterCursor.length === 0 ? "" : " ";
	const nextLine = `${beforePrefix}${item.value}${suffix}${afterCursor}`;
	const nextLines = [...lines];
	nextLines[cursorLine] = nextLine;
	return { lines: nextLines, cursorLine, cursorCol: beforePrefix.length + item.value.length + suffix.length };
}

function withProjectAutocomplete(current: AutocompleteProvider): AutocompleteProvider {
	return {
		triggerCharacters: Array.from(new Set([...(current.triggerCharacters ?? []), "@"])),
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const currentLine = lines[cursorLine] ?? "";
			const prefix = extractProjectToken(currentLine, cursorCol);
			if (prefix === undefined) return current.getSuggestions(lines, cursorLine, cursorCol, options);

			const [projectItemsResult, currentResult] = await Promise.all([
				loadProjects().then((projects) => scopedProjectItems(projects, prefix)),
				current.getSuggestions(lines, cursorLine, cursorCol, options),
			]);
			if (projectItemsResult.length === 0) return currentResult;
			if (currentResult === null || currentResult.prefix !== prefix) return { items: projectItemsResult, prefix };

			const seen = new Set(projectItemsResult.map((item) => item.value));
			return {
				prefix,
				items: [...projectItemsResult, ...currentResult.items.filter((item) => !seen.has(item.value))],
			};
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (prefix.startsWith("@") && item.value.startsWith("@")) {
				return applyProjectCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

function quoteAtPath(path: string): string {
	return /\s/.test(path) ? `@"${path.replace(/"/g, '\\"')}"` : `@${path}`;
}

function resolveProjectReferences(text: string, projects: ProjectReferences): string {
	return text.replace(TOKEN_BOUNDARY_PATTERN, (match, boundary: string, name: string, suffix: string | undefined) => {
		const projectPath = projects[name];
		if (projectPath === undefined) return match;
		const resolvedPath = suffix ? resolve(projectPath, suffix.slice(1)) : projectPath;
		if (!isWithinOrEqual(resolvedPath, projectPath)) return match;
		return `${boundary}${quoteAtPath(resolvedPath)}`;
	});
}

async function addProject(args: string, cwd: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
	const [name, pathArg] = splitArgs(args);
	const nameError = validateProjectName(name ?? "");
	if (nameError) return { ok: false, message: `Usage: /add-project <Name> [path]. ${nameError}` };
	const projectPath = await resolveProjectPath(pathArg, cwd);
	const projects = await loadProjects();
	projects[name ?? ""] = projectPath;
	await saveProjects(projects);
	return { ok: true, message: `Added @${name} → ${projectPath}` };
}

async function removeProject(args: string): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
	const [name] = splitArgs(args);
	const nameError = validateProjectName(name ?? "");
	if (nameError) return { ok: false, message: `Usage: /remove-project <Name>. ${nameError}` };
	const projects = await loadProjects();
	if (projects[name ?? ""] === undefined) return { ok: false, message: `No project named @${name}.` };
	delete projects[name ?? ""];
	await saveProjects(projects);
	return { ok: true, message: `Removed @${name}` };
}

async function projectCompletions(argumentPrefix: string): Promise<AutocompleteItem[] | null> {
	const projects = await loadProjects();
	const items = projectItems(projects, argumentPrefix.replace(/^@/, "")).map((item) => ({
		value: item.value.replace(/^@/, ""),
		label: item.label,
		description: item.description,
	}));
	return items.length > 0 ? items : null;
}

export default function projectReferences(pi: ExtensionAPI) {
	pi.on("resources_discover", (_event, ctx) => {
		// resources_discover runs after all session_start handlers. pi-fff installs
		// its @-mention provider in session_start, so installing here deterministically
		// makes project refs the outer wrapper and lets us merge with FFF file hits.
		ctx.ui.addAutocompleteProvider(withProjectAutocomplete);
	});

	pi.on("input", async (event) => {
		if (event.source === "extension") return { action: "continue" };
		const projects = await loadProjects();
		const text = resolveProjectReferences(event.text, projects);
		if (text === event.text) return { action: "continue" };
		return { action: "transform", text, images: event.images };
	});

	pi.registerCommand("add-project", {
		description: "Register current directory (or path) as a global @project. Usage: /add-project <Name> [path]",
		handler: async (args, ctx) => {
			try {
				const result = await addProject(args, ctx.cwd);
				ctx.ui.notify(result.message, result.ok ? "info" : "warning");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : "Failed to add project.", "error");
			}
		},
	});

	pi.registerCommand("remove-project", {
		description: "Remove a global @project. Usage: /remove-project <Name>",
		getArgumentCompletions: projectCompletions,
		handler: async (args, ctx) => {
			const result = await removeProject(args);
			ctx.ui.notify(result.message, result.ok ? "info" : "warning");
		},
	});

	pi.registerCommand("projects", {
		description: "List global @project references.",
		handler: async (_args, ctx) => {
			const projects = sortProjects(await loadProjects());
			const entries = Object.entries(projects);
			if (entries.length === 0) {
				ctx.ui.notify("No projects registered. Use /add-project <Name>.", "info");
				return;
			}
			ctx.ui.notify(entries.map(([name, path]) => `@${name} → ${path}`).join("\n"), "info");
		},
	});
}
