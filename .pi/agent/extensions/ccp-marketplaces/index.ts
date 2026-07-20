import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LEGACY_PROJECT_CONFIG_PATH = ".pi/ccp-marketplaces.json";
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".pi", "ccp-marketplaces.json");
const GLOBAL_GENERATED_SKILLS_PATH = path.join(os.homedir(), ".pi", "ccp-generated-skills");
const GLOBAL_CLONES_PATH = path.join(os.homedir(), ".pi", "ccp-marketplace-clones.json");
const GLOBAL_CLONES_DIR = path.join(os.homedir(), ".pi", "ccp-marketplace-clones");

type Marketplace = { name: string; path: string; enabled: boolean; gitUrl?: string };
type PluginSelection = { marketplace: string; plugin: string; enabled: boolean };
type Config = { marketplaces: Marketplace[]; plugins: PluginSelection[] };
type CloneRecord = { url: string; path: string };
type CloneRegistry = { clones: CloneRecord[] };
type MarketplacePlugin = { name: string; description: string; source: string };
type PluginManifest = { name: string; skills?: string };
type GeneratedSkill = { sourceDir: string; targetDir: string; namePrefix: string };

type ToggleItem = { id: string; label: string; enabled: boolean };

const EMPTY_CONFIG: Config = { marketplaces: [], plugins: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function gitUrlName(url: string): string {
	const withoutTrailingSlash = url.replace(/\/+$/g, "");
	const lastSegment = withoutTrailingSlash.split("/").pop() ?? "marketplace";
	return lastSegment.replace(/\.git$/i, "");
}

function clonePathForGitUrl(url: string): string {
	const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
	return path.join(GLOBAL_CLONES_DIR, `${normalizeSkillName(gitUrlName(url))}-${hash}`);
}

function normalizeSkillName(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "") || "skill";
}

function uniqueName(base: string, used: Set<string>): string {
	let candidate = base;
	let suffix = 2;
	while (used.has(candidate)) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	used.add(candidate);
	return candidate;
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch {
		return undefined;
	}
}

async function loadConfig(cwd: string): Promise<Config> {
	const globalRaw = await readJsonFile(GLOBAL_CONFIG_PATH);
	const hasGlobalConfig = isRecord(globalRaw);
	const raw = hasGlobalConfig ? globalRaw : await readJsonFile(path.join(cwd, LEGACY_PROJECT_CONFIG_PATH));
	if (!isRecord(raw)) return EMPTY_CONFIG;

	const marketplaces: Marketplace[] = [];
	for (const item of Array.isArray(raw.marketplaces) ? raw.marketplaces : []) {
		if (!isRecord(item)) continue;
		const name = readString(item, "name");
		const marketplacePath = readString(item, "path");
		const resolvedMarketplacePath = marketplacePath && !hasGlobalConfig && !path.isAbsolute(marketplacePath) ? path.resolve(cwd, marketplacePath) : marketplacePath;
		if (name && resolvedMarketplacePath) marketplaces.push({ name, path: resolvedMarketplacePath, enabled: readBoolean(item, "enabled") ?? true, gitUrl: readString(item, "gitUrl") });
	}

	const plugins: PluginSelection[] = [];
	for (const item of Array.isArray(raw.plugins) ? raw.plugins : []) {
		if (!isRecord(item)) continue;
		const marketplace = readString(item, "marketplace");
		const plugin = readString(item, "plugin");
		if (marketplace && plugin) plugins.push({ marketplace, plugin, enabled: readBoolean(item, "enabled") ?? false });
	}

	return { marketplaces, plugins };
}

async function saveConfig(_cwd: string, config: Config): Promise<void> {
	await mkdir(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true });
	await writeFile(GLOBAL_CONFIG_PATH, `${JSON.stringify(config, null, "\t")}\n`);
}

async function loadCloneRegistry(): Promise<CloneRegistry> {
	const raw = await readJsonFile(GLOBAL_CLONES_PATH);
	if (!isRecord(raw) || !Array.isArray(raw.clones)) return { clones: [] };
	const clones: CloneRecord[] = [];
	for (const item of raw.clones) {
		if (!isRecord(item)) continue;
		const url = readString(item, "url");
		const clonePath = readString(item, "path");
		if (url && clonePath) clones.push({ url, path: clonePath });
	}
	return { clones };
}

async function saveCloneRegistry(registry: CloneRegistry): Promise<void> {
	await mkdir(path.dirname(GLOBAL_CLONES_PATH), { recursive: true });
	await writeFile(GLOBAL_CLONES_PATH, `${JSON.stringify(registry, null, "\t")}\n`);
}

function resolveMarketplacePath(cwd: string, marketplace: Marketplace): string {
	return path.isAbsolute(marketplace.path) ? marketplace.path : path.resolve(cwd, marketplace.path);
}

async function listMarketplacePlugins(marketplacePath: string): Promise<MarketplacePlugin[]> {
	const raw = await readJsonFile(path.join(marketplacePath, ".claude-plugin", "marketplace.json"));
	if (!isRecord(raw) || !Array.isArray(raw.plugins)) return [];

	const plugins: MarketplacePlugin[] = [];
	for (const item of raw.plugins) {
		if (!isRecord(item)) continue;
		const name = readString(item, "name");
		const source = readString(item, "source");
		if (name && source) plugins.push({ name, source, description: readString(item, "description") ?? "" });
	}
	return plugins;
}

async function readPluginManifest(pluginPath: string): Promise<PluginManifest | undefined> {
	const raw = await readJsonFile(path.join(pluginPath, ".claude-plugin", "plugin.json"));
	if (!isRecord(raw)) return undefined;
	const name = readString(raw, "name");
	if (!name) return undefined;
	const skills = readString(raw, "skills");
	return skills ? { name, skills } : { name };
}

function pluginEnabled(config: Config, marketplace: string, plugin: string): boolean {
	return config.plugins.some((item) => item.marketplace === marketplace && item.plugin === plugin && item.enabled);
}

function setPluginEnabled(config: Config, marketplace: string, plugin: string, enabled: boolean): Config {
	const plugins = config.plugins.filter((item) => !(item.marketplace === marketplace && item.plugin === plugin));
	plugins.push({ marketplace, plugin, enabled });
	return { ...config, plugins };
}

async function skillDirectories(skillsPath: string): Promise<string[]> {
	if (existsSync(path.join(skillsPath, "SKILL.md"))) return [skillsPath];
	const entries = await readdir(skillsPath, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && existsSync(path.join(skillsPath, entry.name, "SKILL.md")))
		.map((entry) => path.join(skillsPath, entry.name));
}

function yamlQuote(value: string): string {
	return JSON.stringify(value.trim());
}

function yamlScalar(value: string): string {
	const trimmed = value.trim();
	return /^[>|][+-]?$/.test(trimmed) ? trimmed : yamlQuote(trimmed);
}

async function copySanitizedSkill(sourceDir: string, targetDir: string, namePrefix: string): Promise<void> {
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(path.dirname(targetDir), { recursive: true });
	await cp(sourceDir, targetDir, { recursive: true });
	const skillPath = path.join(targetDir, "SKILL.md");
	const content = await readFile(skillPath, "utf8");
	const normalizedPrefix = normalizeSkillName(namePrefix);
	const normalized = content
		.replace(/^name:\s*(.+)$/m, (_line, name: string) => `name: ${yamlQuote(`${normalizedPrefix}-${normalizeSkillName(name)}`)}`)
		.replace(/^(description|argument-hint|allowed-tools):\s*(.+)$/gm, (_line, key: string, value: string) => `${key}: ${yamlScalar(value)}`);
	await writeFile(skillPath, normalized);
}

async function configuredGeneratedSkills(cwd: string, config: Config): Promise<GeneratedSkill[]> {
	const skills: GeneratedSkill[] = [];

	for (const marketplace of config.marketplaces.filter((item) => item.enabled)) {
		const marketplacePath = resolveMarketplacePath(cwd, marketplace);
		const plugins = await listMarketplacePlugins(marketplacePath);
		for (const plugin of plugins) {
			if (!pluginEnabled(config, marketplace.name, plugin.name)) continue;
			const pluginPath = path.resolve(marketplacePath, plugin.source);
			const manifest = await readPluginManifest(pluginPath);
			if (!manifest?.skills) continue;
			const sourceSkillsPath = path.resolve(pluginPath, manifest.skills);
			if (!existsSync(sourceSkillsPath)) continue;
			for (const sourceSkillDir of await skillDirectories(sourceSkillsPath)) {
				skills.push({
					sourceDir: sourceSkillDir,
					targetDir: path.join(GLOBAL_GENERATED_SKILLS_PATH, marketplace.name, plugin.name, path.basename(sourceSkillDir)),
					namePrefix: marketplace.name,
				});
			}
		}
	}

	return skills;
}

async function existingGeneratedSkillPaths(root: string): Promise<string[]> {
	if (!existsSync(root)) return [];
	if (existsSync(path.join(root, "SKILL.md"))) return [root];

	const paths: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (entry.isDirectory()) paths.push(...await existingGeneratedSkillPaths(path.join(root, entry.name)));
	}
	return paths;
}

async function pruneGeneratedSkills(expectedPaths: Set<string>): Promise<void> {
	const existingPaths = await existingGeneratedSkillPaths(GLOBAL_GENERATED_SKILLS_PATH);
	const stalePaths = existingPaths.filter((existingPath) => !expectedPaths.has(existingPath));
	const parentPaths = new Set<string>();

	for (const stalePath of stalePaths) {
		await rm(stalePath, { recursive: true, force: true });
		parentPaths.add(path.dirname(stalePath));
		parentPaths.add(path.dirname(path.dirname(stalePath)));
	}

	for (const parentPath of [...parentPaths].sort((left, right) => right.length - left.length)) {
		if (existsSync(parentPath) && (await readdir(parentPath)).length === 0) await rm(parentPath, { recursive: true });
	}
}

async function reconcileGeneratedSkills(cwd: string, config: Config): Promise<void> {
	const skills = await configuredGeneratedSkills(cwd, config);
	for (const skill of skills) await copySanitizedSkill(skill.sourceDir, skill.targetDir, skill.namePrefix);
	await pruneGeneratedSkills(new Set(skills.map((skill) => skill.targetDir)));
}

async function enabledSkillPaths(cwd: string, config: Config): Promise<string[]> {
	const skills = await configuredGeneratedSkills(cwd, config);
	return skills.map((skill) => skill.targetDir).filter((skillPath) => existsSync(skillPath));
}

type ToggleListResult =
	| { action: "save"; enabled: Set<string> }
	| { action: "update"; enabled: Set<string> }
	| { action: "delete"; enabled: Set<string> }
	| { action: "cancel" };

async function toggleList(title: string, items: ToggleItem[], ctx: ExtensionCommandContext, options?: { updateHint?: string; deleteHint?: string }): Promise<ToggleListResult> {
	const enabled = new Set(items.filter((item) => item.enabled).map((item) => item.id));
	const baseLabels = new Map(items.map((item) => [item.id, item.label]));
	const statusLabel = (isEnabled: boolean, label: string) => `${isEnabled ? "● Enabled" : "○ Disabled"}  ${label}`;
	const sortedItems = [...items].sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.label.localeCompare(right.label));
	const settingItems: SettingItem[] = sortedItems.map((item) => ({
		id: item.id,
		label: statusLabel(item.enabled, item.label),
		currentValue: item.enabled ? "enabled" : "disabled",
		values: ["enabled", "disabled"],
	}));

	const result = await ctx.ui.custom<{ action: "save" } | { action: "update" } | { action: "delete" } | { action: "cancel" }>((_tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 1));
		const extraHints = [options?.updateHint ? `Shift+U ${options.updateHint}` : undefined, options?.deleteHint ? `Shift+D ${options.deleteHint}` : undefined].filter((hint) => hint !== undefined);
		const hint = ["Space toggles", "Enter confirms", ...extraHints, "Esc cancels"].join(", ");
		container.addChild(new Text(theme.fg("muted", hint), 1, 2));
		const settingsList = new SettingsList(
			settingItems,
			Math.min(settingItems.length + 2, 18),
			getSettingsListTheme(),
			(id, value) => {
				const isEnabled = value === "enabled";
				if (isEnabled) enabled.add(id);
				else enabled.delete(id);
				const item = settingItems.find((candidate) => candidate.id === id);
				const baseLabel = baseLabels.get(id);
				if (item && baseLabel) item.label = statusLabel(isEnabled, baseLabel);
				settingsList.updateValue(id, value);
			},
			() => done({ action: "save" }),
			{ enableSearch: true },
		);
		container.addChild(settingsList, 0, 3);
		return {
			render: (width) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				if (data === "\r" || data === "\n") {
					done({ action: "save" });
					return;
				}
				if (data === "U" && options?.updateHint) {
					done({ action: "update" });
					return;
				}
				if (data === "D" && options?.deleteHint) {
					done({ action: "delete" });
					return;
				}
				if (data === "\u001b") {
					done({ action: "save" });
					return;
				}
				settingsList.handleInput?.(data);
			},
		};
	});

	if (result.action === "save") return { action: "save", enabled };
	if (result.action === "update") return { action: "update", enabled };
	if (result.action === "delete") return { action: "delete", enabled };
	return { action: "cancel" };
}

async function ensureGitMarketplaceClone(pi: ExtensionAPI, gitUrl: string, ctx: ExtensionCommandContext): Promise<string | undefined> {
	const registry = await loadCloneRegistry();
	const existing = registry.clones.find((clone) => clone.url === gitUrl);
	const clonePath = existing?.path ?? clonePathForGitUrl(gitUrl);
	if (!existsSync(clonePath)) {
		await mkdir(path.dirname(clonePath), { recursive: true });
		ctx.ui.setStatus("ccp", `Cloning ${gitUrl}...`);
		const result = await pi.exec("git", ["clone", gitUrl, clonePath], { signal: ctx.signal });
		ctx.ui.setStatus("ccp", undefined);
		if (result.code !== 0) {
			ctx.ui.notify(`Clone failed: ${result.stderr || result.stdout}`, "error");
			return undefined;
		}
	}
	if (!existing) await saveCloneRegistry({ clones: [...registry.clones, { url: gitUrl, path: clonePath }] });
	return clonePath;
}

async function addMarketplace(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const input = args.trim();
	if (!input) {
		ctx.ui.notify("Usage: /ccp-marketplace-add <local-repo-path|git:<url>>", "warning");
		return;
	}
	const gitUrl = input.startsWith("git:") ? input.slice("git:".length).trim() : undefined;
	const absolutePath = gitUrl ? await ensureGitMarketplaceClone(pi, gitUrl, ctx) : path.isAbsolute(input) ? input : path.resolve(ctx.cwd, input);
	if (!absolutePath) return;
	if (!existsSync(path.join(absolutePath, ".claude-plugin", "marketplace.json"))) {
		ctx.ui.notify("No .claude-plugin/marketplace.json found there", "error");
		return;
	}
	const config = await loadConfig(ctx.cwd);
	const name = uniqueName(normalizeSkillName(gitUrl ? gitUrlName(gitUrl) : path.basename(absolutePath)), new Set(config.marketplaces.map((item) => item.name)));
	const nextConfig = { ...config, marketplaces: [...config.marketplaces, { name, path: absolutePath, enabled: true, gitUrl }] };
	await saveConfig(ctx.cwd, nextConfig);
	await reconcileGeneratedSkills(ctx.cwd, nextConfig);
	ctx.ui.notify(`Added marketplace: ${name}`, "info");
	await ctx.reload();
}

async function managePlugins(ctx: ExtensionCommandContext): Promise<void> {
	const config = await loadConfig(ctx.cwd);
	const marketplace = await chooseMarketplace(config, ctx);
	if (!marketplace) return;
	const plugins = await listMarketplacePlugins(resolveMarketplacePath(ctx.cwd, marketplace));
	const selected = await toggleList(
		`Plugins in ${marketplace.name}`,
		plugins.map((plugin) => ({ id: plugin.name, label: `${plugin.name} — ${plugin.description}`, enabled: pluginEnabled(config, marketplace.name, plugin.name) })),
		ctx,
	);
	if (selected.action !== "save") return;
	let nextConfig = config;
	for (const plugin of plugins) nextConfig = setPluginEnabled(nextConfig, marketplace.name, plugin.name, selected.enabled.has(plugin.name));
	await saveConfig(ctx.cwd, nextConfig);
	await reconcileGeneratedSkills(ctx.cwd, nextConfig);
	ctx.ui.notify(`Saved plugin selection for ${marketplace.name}`, "info");
	await ctx.reload();
}

async function chooseMarketplace(config: Config, ctx: ExtensionCommandContext): Promise<Marketplace | undefined> {
	if (config.marketplaces.length === 0) {
		ctx.ui.notify("No marketplaces configured. Use /ccp-marketplace-add <path|git:<url>>.", "warning");
		return undefined;
	}
	const labels = config.marketplaces.map((item) => `${item.enabled ? "✓" : "✗"} ${item.name} — ${item.path}`);
	const choice = await ctx.ui.select("Select marketplace", labels);
	if (!choice) return undefined;
	const index = labels.indexOf(choice);
	return index >= 0 ? config.marketplaces[index] : undefined;
}

async function deleteMarketplace(config: Config, ctx: ExtensionCommandContext): Promise<void> {
	const marketplace = await chooseMarketplace(config, ctx);
	if (!marketplace) return;
	const nextConfig: Config = {
		marketplaces: config.marketplaces.filter((item) => item.name !== marketplace.name),
		plugins: config.plugins.filter((item) => item.marketplace !== marketplace.name),
	};
	await saveConfig(ctx.cwd, nextConfig);
	await reconcileGeneratedSkills(ctx.cwd, nextConfig);
	if (marketplace.gitUrl) {
		const registry = await loadCloneRegistry();
		const clone = registry.clones.find((item) => item.url === marketplace.gitUrl);
		const clonePath = clone?.path ?? marketplace.path;
		await rm(clonePath, { recursive: true, force: true });
		await saveCloneRegistry({ clones: registry.clones.filter((item) => item.url !== marketplace.gitUrl) });
	}
	ctx.ui.notify(`Deleted marketplace: ${marketplace.name}`, "info");
	await ctx.reload();
}

async function manageMarketplaces(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const config = await loadConfig(ctx.cwd);
	const selected = await toggleList(
		"Marketplaces",
		config.marketplaces.map((marketplace) => ({ id: marketplace.name, label: `${marketplace.name} — ${marketplace.path}`, enabled: marketplace.enabled })),
		ctx,
		{ updateHint: "updates enabled marketplaces", deleteHint: "deletes a marketplace" },
	);
	if (selected.action === "cancel") return;
	const nextConfig = { ...config, marketplaces: config.marketplaces.map((item) => ({ ...item, enabled: selected.enabled.has(item.name) })) };
	if (selected.action === "delete") {
		await deleteMarketplace(nextConfig, ctx);
		return;
	}
	await saveConfig(ctx.cwd, nextConfig);
	if (selected.action === "update") {
		await updateEnabledMarketplaces(pi, nextConfig, ctx);
		return;
	}
	await reconcileGeneratedSkills(ctx.cwd, nextConfig);
	ctx.ui.notify("Saved marketplace selection", "info");
	await ctx.reload();
}

async function updateEnabledMarketplaces(pi: ExtensionAPI, config: Config, ctx: ExtensionCommandContext): Promise<void> {
	const enabledMarketplaces = config.marketplaces.filter((marketplace) => marketplace.enabled);
	if (enabledMarketplaces.length === 0) {
		await reconcileGeneratedSkills(ctx.cwd, config);
		ctx.ui.notify("No enabled marketplaces to update", "warning");
		await ctx.reload();
		return;
	}
	for (const marketplace of enabledMarketplaces) {
		const marketplacePath = resolveMarketplacePath(ctx.cwd, marketplace);
		ctx.ui.setStatus("ccp", `Updating ${marketplace.name}...`);
		const result = await pi.exec("git", ["-C", marketplacePath, "pull", "--ff-only"], { signal: ctx.signal });
		if (result.code !== 0) {
			ctx.ui.setStatus("ccp", undefined);
			await reconcileGeneratedSkills(ctx.cwd, config);
			ctx.ui.notify(`Update failed for ${marketplace.name}: ${result.stderr || result.stdout}`, "error");
			await ctx.reload();
			return;
		}
	}
	ctx.ui.setStatus("ccp", undefined);
	await reconcileGeneratedSkills(ctx.cwd, config);
	ctx.ui.notify(`Updated ${enabledMarketplaces.length} marketplace(s)`, "info");
	await ctx.reload();
}

export default function ccpMarketplaces(pi: ExtensionAPI) {
	pi.on("resources_discover", async (event) => ({ skillPaths: await enabledSkillPaths(event.cwd, await loadConfig(event.cwd)) }));
	pi.registerCommand("ccp-marketplace-add", { description: "Add a Claude plugin marketplace repo: /ccp-marketplace-add <path|git:<url>>", handler: async (args, ctx) => addMarketplace(pi, args, ctx) });
	pi.registerCommand("ccp-marketplaces", { description: "Enable/disable configured plugin marketplaces; press Shift+U inside to update enabled marketplaces", handler: async (_args, ctx) => manageMarketplaces(pi, ctx) });
	pi.registerCommand("ccp-plugins", { description: "Enable/disable plugins from configured marketplaces", handler: async (_args, ctx) => managePlugins(ctx) });
}
