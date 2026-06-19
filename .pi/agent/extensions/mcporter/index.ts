import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fuse from "fuse.js";
import { createRuntime } from "mcporter";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
	type AgentToolResult,
	type ExtensionAPI,
	type TruncationOptions,
	type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import type { Runtime } from "mcporter";

const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;
const MAX_INSPECT_BYTES = 24_000;

const McpSearchParams = Type.Object({
	query: Type.Optional(
		Type.String({
			description:
				"Search MCP servers/tools by capability, name, description, or parameter. Omit to list servers. Multi-word queries return closest partial matches.",
		}),
	),
	limit: Type.Optional(
		Type.Number({
			description: `Maximum matches to return. Defaults to ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}.`,
		}),
	),
});

const McpInspectParams = Type.Object({
	target: Type.String({
		description:
			"Server, tool selector, or resource server. Examples: 'atlassian', 'org.github_get_issue'.",
	}),
	mode: Type.Optional(
		Type.String({ description: "One of: schema (default), brief, list, resource." }),
	),
	uri: Type.Optional(Type.String({ description: "Resource URI/path for mode=resource." })),
});

const McpCallParams = Type.Object({
	tool: Type.String({ description: "Tool selector to call, e.g. 'server.tool_name'." }),
	params: Type.Optional(
		Type.Array(Type.String({ description: "mcporter CLI argument in key=value form." }), {
			description:
				"Arguments passed to mcporter call as key=value strings. Use JSON strings for structured values if the target tool expects them.",
		}),
	),
});

type ToolSummary = {
	readonly server: string;
	readonly name: string;
	readonly description?: string;
	readonly inputSchemaText?: string;
};
type MatchedField = "name" | "description" | "params";
type ScoredTool = {
	readonly tool: ToolSummary;
	readonly score: number;
	readonly matchedFields: readonly MatchedField[];
};

type SearchDocument = ToolSummary & {
	readonly id: string;
	readonly selector: string;
	readonly searchableName: string;
	readonly searchableDescription: string;
	readonly searchableParams: string;
};
type TokenMatch = {
	readonly score: number;
	readonly matchedFields: readonly MatchedField[];
};

const FUSE_THRESHOLD = 0.32;
const MIN_PARTIAL_MATCH_RATIO = 0.6;
const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokensOf = (text: string): string[] => normalize(text).split(/\s+/).filter(Boolean);
const clampLimit = (limit: number | undefined): number =>
	typeof limit === "number" && Number.isFinite(limit)
		? Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(limit)))
		: DEFAULT_SEARCH_LIMIT;

function property(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null
		? Object.getOwnPropertyDescriptor(value, key)?.value
		: undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
	const found = property(value, key);
	return typeof found === "string" ? found : undefined;
}

function stringArrayProperty(value: unknown, key: string): readonly string[] | undefined {
	const found = property(value, key);
	return Array.isArray(found) && found.every((item) => typeof item === "string") ? found : undefined;
}

let runtimePromise: Promise<Runtime> | undefined;

function runtime(): Promise<Runtime> {
	runtimePromise ??= createRuntime({ clientInfo: { name: "pi-mcporter-extension", version: "1.0.0" } });
	return runtimePromise;
}

function toolResult(text: string, details: unknown): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

function quoted(text: string): string {
	return `"${text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

type ToolCallTheme = {
	fg(color: "toolTitle" | "accent", text: string): string;
	bold(text: string): string;
};

type ToolResultTheme = {
	fg(color: "toolOutput" | "muted", text: string): string;
};

function formatToolCall(title: string, args: readonly string[], theme: ToolCallTheme): string {
	const styledTitle = theme.fg("toolTitle", theme.bold(title));
	return args.length > 0 ? `${styledTitle} ${theme.fg("accent", args.join(" "))}` : styledTitle;
}

function formatSearchCall(params: unknown, theme: ToolCallTheme): string {
	const query = stringProperty(params, "query")?.trim();
	return formatToolCall("mcp_search", query && query.length > 0 ? [quoted(query)] : [], theme);
}

function formatInspectCall(params: unknown, theme: ToolCallTheme): string {
	const target = stringProperty(params, "target");
	const args = typeof target === "string" ? [quoted(target)] : [];
	const mode = stringProperty(params, "mode");
	const uri = stringProperty(params, "uri");
	return formatToolCall(
		"mcp_inspect",
		[
			...args,
			...(typeof mode === "string" ? [`mode=${quoted(mode)}`] : []),
			...(typeof uri === "string" ? [`uri=${quoted(uri)}`] : []),
		],
		theme,
	);
}

function formatCallCall(params: unknown, theme: ToolCallTheme): string {
	const tool = stringProperty(params, "tool");
	const args = stringArrayProperty(params, "params")?.join(" ");
	return formatToolCall(
		"mcp_call",
		[...(typeof tool === "string" ? [quoted(tool)] : []), ...(args ? [args] : [])],
		theme,
	);
}

function textContent(result: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
	const content = result.content[0];
	return content?.type === "text" && typeof content.text === "string" ? content.text : "";
}

function renderCollapsedResult(): Text {
	return new Text("", 0, 0);
}

function renderExpandedResult(
	result: { readonly content: readonly { readonly type: string; readonly text?: string }[] },
	isPartial: boolean,
	theme: ToolResultTheme,
): Text {
	const text = textContent(result);
	return new Text(text ? theme.fg("toolOutput", text) : isPartial ? theme.fg("muted", "Running…") : "", 0, 0);
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, undefined, 2);
	} catch {
		return String(value);
	}
}

type OutputForAgent =
	| { readonly kind: "complete"; readonly text: string }
	| {
			readonly kind: "truncated";
			readonly text: string;
			readonly truncation: TruncationResult;
			readonly fullOutputPath: string;
	  };

function tempOutputPath(): string {
	return join(tmpdir(), `pi-mcporter-${randomBytes(8).toString("hex")}.log`);
}

async function writeFullOutput(content: string): Promise<string> {
	const path = tempOutputPath();
	await writeFile(path, content, "utf8");
	return path;
}

function truncationFooter(truncation: TruncationResult, fullOutputPath: string): string {
	const startLine = Math.max(1, truncation.totalLines - truncation.outputLines + 1);
	const endLine = truncation.totalLines;
	if (truncation.lastLinePartial) {
		return `[Output truncated. Showing last ${formatSize(truncation.outputBytes)} of line ${endLine}. Full output: ${fullOutputPath}]`;
	}
	if (truncation.truncatedBy === "lines") {
		return `[Output truncated. Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${fullOutputPath}]`;
	}
	return `[Output truncated. Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(truncation.maxBytes)} limit). Full output: ${fullOutputPath}]`;
}

async function truncateOutputForAgent(content: string, options: TruncationOptions): Promise<OutputForAgent> {
	const truncation = truncateTail(content, options);
	if (!truncation.truncated) return { kind: "complete", text: truncation.content };
	const fullOutputPath = await writeFullOutput(content);
	const separator = truncation.content.length > 0 ? "\n\n" : "";
	return {
		kind: "truncated",
		text: `${truncation.content}${separator}${truncationFooter(truncation, fullOutputPath)}`,
		truncation,
		fullOutputPath,
	};
}

function detailsWithOutput(base: Record<string, unknown>, output: OutputForAgent): Record<string, unknown> {
	return output.kind === "truncated"
		? { ...base, truncation: output.truncation, fullOutputPath: output.fullOutputPath }
		: base;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "unknown error";
}

async function serverNames(): Promise<string[]> {
	try {
		return (await runtime()).listServers();
	} catch {
		return [];
	}
}

async function listServersText(): Promise<string> {
	try {
		const names = (await runtime()).listServers();
		return names.map((name) => `- ${name}`).join("\n");
	} catch (error) {
		return `mcporter runtime failed: ${errorMessage(error)}`;
	}
}

async function listServerTools(server: string): Promise<ToolSummary[]> {
	try {
		const tools = await (await runtime()).listTools(server, { includeSchema: true, disableOAuth: true });
		return tools.map((tool) => ({
			server,
			name: tool.name,
			description: tool.description,
			inputSchemaText: typeof tool.inputSchema === "undefined" ? undefined : stringify(tool.inputSchema),
		}));
	} catch {
		return [];
	}
}

function uniqueFields(fields: readonly MatchedField[]): readonly MatchedField[] {
	return fields.filter((field, index) => fields.indexOf(field) === index);
}

function toSearchDocument(tool: ToolSummary, index: number): SearchDocument {
	return {
		...tool,
		id: `${index}`,
		selector: `${tool.server}.${tool.name}`,
		searchableName: normalize(`${tool.server} ${tool.name}`),
		searchableDescription: normalize(tool.description ?? ""),
		searchableParams: normalize(tool.inputSchemaText ?? ""),
	};
}

function keyToField(key: string | undefined): MatchedField | undefined {
	if (key === "searchableName" || key === "selector") return "name";
	if (key === "searchableDescription") return "description";
	if (key === "searchableParams") return "params";
	return undefined;
}

function fieldsFromFuse(matches: readonly { readonly key?: string }[] | undefined): readonly MatchedField[] {
	return uniqueFields(
		(matches ?? [])
			.map((match) => keyToField(match.key))
			.filter((field): field is MatchedField => typeof field === "string"),
	);
}

function uniqueStrings(items: readonly string[]): readonly string[] {
	return items.filter((item, index) => items.indexOf(item) === index);
}

function tokenVariants(token: string): readonly string[] {
	const variants = [token];
	if (token.endsWith("ies") && token.length > 3) variants.push(`${token.slice(0, -3)}y`);
	if (token.endsWith("s") && token.length > 3) variants.push(token.slice(0, -1));
	if (!token.endsWith("s") && token.length > 2) variants.push(`${token}s`);
	return uniqueStrings(variants);
}

function containsToken(text: string, token: string): boolean {
	const variants = tokenVariants(token);
	return tokensOf(text).some((word) => variants.some((variant) => word.includes(variant)));
}

function exactTokenMatch(token: string, document: SearchDocument): TokenMatch | undefined {
	const fields: MatchedField[] = [];
	let score = 0;
	if (containsToken(document.searchableName, token) || containsToken(document.selector, token)) {
		fields.push("name");
		score += 240;
	}
	if (containsToken(document.searchableDescription, token)) {
		fields.push("description");
		score += 80;
	}
	if (containsToken(document.searchableParams, token)) {
		fields.push("params");
		score += 12;
	}
	return fields.length > 0 ? { score, matchedFields: fields } : undefined;
}

function searchFuse(documents: readonly SearchDocument[]): Fuse<SearchDocument> {
	return new Fuse(documents, {
		includeMatches: true,
		includeScore: true,
		ignoreLocation: true,
		minMatchCharLength: 3,
		threshold: FUSE_THRESHOLD,
		keys: [
			{ name: "selector", weight: 0.55 },
			{ name: "searchableName", weight: 0.35 },
			{ name: "searchableDescription", weight: 0.08 },
			{ name: "searchableParams", weight: 0.02 },
		],
	});
}

function mergeTokenMatch(left: TokenMatch | undefined, right: TokenMatch): TokenMatch {
	return {
		score: (left?.score ?? 0) + right.score,
		matchedFields: uniqueFields([...(left?.matchedFields ?? []), ...right.matchedFields]),
	};
}

function scoreFuseMatch(score: number | undefined, fields: readonly MatchedField[]): number {
	const fuzzyScore = Math.round((1 - (score ?? FUSE_THRESHOLD)) * 100);
	const fieldBoost = fields.reduce((total, field) => {
		if (field === "name") return total + 180;
		if (field === "description") return total + 55;
		return total + 8;
	}, 0);
	return fuzzyScore + fieldBoost;
}

function fuseTokenMatches(
	token: string,
	documents: readonly SearchDocument[],
	fuse: Fuse<SearchDocument>,
): Map<string, TokenMatch> {
	const matches = new Map<string, TokenMatch>();
	for (const document of documents) {
		const exactMatch = exactTokenMatch(token, document);
		if (exactMatch) matches.set(document.id, exactMatch);
	}
	if (token.length < 3) return matches;

	for (const result of fuse.search(token)) {
		const fields = fieldsFromFuse(result.matches);
		if (fields.length === 0) continue;
		const fuzzyMatch = { score: scoreFuseMatch(result.score, fields), matchedFields: fields };
		matches.set(result.item.id, mergeTokenMatch(matches.get(result.item.id), fuzzyMatch));
	}

	return matches;
}

function requiredTokenMatches(tokenCount: number): number {
	if (tokenCount <= 1) return tokenCount;
	if (tokenCount === 2) return 1;
	return Math.max(2, Math.ceil(tokenCount * MIN_PARTIAL_MATCH_RATIO));
}

function scoreTools(queryTokens: readonly string[], tools: readonly ToolSummary[], minimumTokenMatches?: number): ScoredTool[] {
	const documents = tools.map(toSearchDocument);
	const fuse = searchFuse(documents);
	const tokenMatches = queryTokens.map((token) => fuseTokenMatches(token, documents, fuse));
	const requiredMatches = minimumTokenMatches ?? requiredTokenMatches(queryTokens.length);
	return documents.flatMap((document) => {
		const matches = tokenMatches.map((matches) => matches.get(document.id));
		const foundMatches = matches.filter((match): match is TokenMatch => typeof match !== "undefined");
		if (foundMatches.length < requiredMatches) return [];
		return [
			{
				tool: document,
				score: foundMatches.reduce((total, match) => total + match.score, 0) + foundMatches.length * 400,
				matchedFields: uniqueFields(foundMatches.flatMap((match) => match.matchedFields)),
			},
		];
	});
}

function firstLine(text: string | undefined): string | undefined {
	return text?.split("\n").find((line) => line.trim().length > 0)?.trim();
}

function formatMatch({ tool, matchedFields }: ScoredTool): string {
	const description = firstLine(tool.description);
	const matchText = matchedFields.length > 0 ? ` _(matched: ${matchedFields.join(", ")})_` : "";
	return description ? `- ${tool.name}${matchText}: ${description}` : `- ${tool.name}${matchText}`;
}

function groupByServer(matches: readonly ScoredTool[]): string {
	const grouped = matches.reduce<Map<string, string[]>>((acc, match) => {
		acc.set(match.tool.server, [...(acc.get(match.tool.server) ?? []), formatMatch(match)]);
		return acc;
	}, new Map());
	return Array.from(grouped.entries())
		.map(([server, lines]) => `## ${server}\n${lines.join("\n")}`)
		.join("\n\n");
}

function selectedServers(queryTokens: readonly string[], servers: readonly string[]): readonly string[] {
	return servers.filter((server) => queryTokens.includes(normalize(server)));
}

function removeServerTokens(queryTokens: readonly string[], servers: readonly string[]): readonly string[] {
	const serverTokens = servers.map(normalize);
	return queryTokens.filter((token) => !serverTokens.includes(token));
}

function unscoredTools(tools: readonly ToolSummary[]): readonly ScoredTool[] {
	return tools.map((tool) => ({ tool, score: 0, matchedFields: [] }));
}

async function searchMcporter(query: string | undefined, requestedLimit: number | undefined): Promise<string> {
	const list = await listServersText();
	const queryTokens = tokensOf(query ?? "");
	if (queryTokens.length === 0) {
		return `${list}\n\nTip: call mcp_search with capability words to search tool names, descriptions, and parameters.`;
	}

	const servers = await serverNames();
	const scopedServers = selectedServers(queryTokens, servers);
	const tools = (await Promise.all(servers.map(listServerTools))).flat();
	const scopedTools = scopedServers.length > 0 ? tools.filter((tool) => scopedServers.includes(tool.server)) : tools;
	const searchTokens = scopedServers.length > 0 ? removeServerTokens(queryTokens, scopedServers) : queryTokens;
	const limit = clampLimit(requestedLimit);

	if (searchTokens.length === 0) {
		const shown = unscoredTools(scopedTools).slice(0, limit);
		const suffix = scopedTools.length > shown.length ? `\n\nShowing top ${shown.length} of ${scopedTools.length} tools.` : "";
		return `${groupByServer(shown)}${suffix}`;
	}

	const minimumTokenMatches = scopedServers.length > 0 ? 1 : undefined;
	const matches = scoreTools(searchTokens, scopedTools, minimumTokenMatches).sort(
		(left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
	);
	const shown = matches.slice(0, limit);

	if (shown.length === 0) {
		if (scopedServers.length > 0) {
			const shownTools = unscoredTools(scopedTools).slice(0, limit);
			return `No mcporter tools in ${scopedServers.join(", ")} matched '${searchTokens.join(" ")}'. Available tools:\n\n${groupByServer(shownTools)}`;
		}
		return `No mcporter tools matched '${query}'. Try fewer or broader words.\n\nServers:\n${list}`;
	}

	const suffix = matches.length > shown.length ? `\n\nShowing top ${shown.length} of ${matches.length} matches. Narrow the query for a better result.` : "";
	return `${groupByServer(shown)}${suffix}`;
}

type ToolSelector = { readonly server: string; readonly toolName: string };

function splitToolSelector(selector: string): ToolSelector | undefined {
	const separatorIndex = selector.indexOf(".");
	if (separatorIndex <= 0 || separatorIndex === selector.length - 1) return undefined;
	return {
		server: selector.slice(0, separatorIndex),
		toolName: selector.slice(separatorIndex + 1),
	};
}

function parseParamValue(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed.length === 0) return "";
	try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
}

function parseCallParams(params: readonly string[]): Record<string, unknown> {
	return params.reduce<Record<string, unknown>>((acc, param) => {
		const equalsIndex = param.indexOf("=");
		const colonIndex = param.indexOf(":");
		const separatorIndex = equalsIndex >= 0 ? equalsIndex : colonIndex;
		if (separatorIndex <= 0) return acc;
		const key = param.slice(0, separatorIndex).trim();
		if (key.length === 0) return acc;
		return { ...acc, [key]: parseParamValue(param.slice(separatorIndex + 1)) };
	}, {});
}

function formatToolBrief(server: string, tools: readonly ToolSummary[]): string {
	return tools
		.map((tool) => `function ${server}.${tool.name}(${tool.inputSchemaText ?? ""});`)
		.join("\n");
}

async function inspectMcporter(target: string, mode: string | undefined, uri: string | undefined): Promise<AgentToolResult<unknown>> {
	const normalizedMode = mode?.trim().toLowerCase() || "schema";
	try {
		const sdk = await runtime();
		if (normalizedMode === "resource") {
			const result = uri ? await sdk.readResource(target, uri, { disableOAuth: true }) : await sdk.listResources(target, { disableOAuth: true });
			const output = await truncateOutputForAgent(stringify(result), {
				maxBytes: MAX_INSPECT_BYTES,
				maxLines: DEFAULT_MAX_LINES,
			});
			return toolResult(output.text, detailsWithOutput({ target, mode, uri }, output));
		}

		const selector = splitToolSelector(target);
		const server = selector?.server ?? target;
		const tools = await listServerTools(server);
		if (selector) {
			const found = tools.find((tool) => tool.name === selector.toolName);
			if (!found) return toolResult(`No tool found for '${target}'.`, { target, mode });
			const output = await truncateOutputForAgent(stringify(found), {
				maxBytes: MAX_INSPECT_BYTES,
				maxLines: DEFAULT_MAX_LINES,
			});
			return toolResult(output.text, detailsWithOutput({ target, mode }, output));
		}

		if (normalizedMode === "brief") return toolResult(formatToolBrief(server, tools), { target, mode });
		if (normalizedMode === "list") return toolResult(tools.map((tool) => `- ${tool.name}`).join("\n"), { target, mode });
		return toolResult(
			`Refusing broad schema dump for server '${target}' because it can consume too much context. Use mcp_search, then inspect a specific tool selector like '${target}.tool_name'.`,
			{ target, mode },
		);
	} catch (error) {
		const message = errorMessage(error);
		return toolResult(`Error: ${message}`, { target, mode, uri, error: message });
	}
}

async function callMcporter(tool: string, params: readonly string[]): Promise<AgentToolResult<unknown>> {
	const selector = splitToolSelector(tool);
	if (!selector) return toolResult(`Error: expected tool selector like 'server.tool_name', got '${tool}'.`, { tool });
	const args = parseCallParams(params);
	try {
		const result = await (await runtime()).callTool(selector.server, selector.toolName, { args });
		const output = await truncateOutputForAgent(stringify(result), {
			maxBytes: DEFAULT_MAX_BYTES,
			maxLines: DEFAULT_MAX_LINES,
		});
		return toolResult(
			output.text,
			detailsWithOutput({ tool, server: selector.server, toolName: selector.toolName, args }, output),
		);
	} catch (error) {
		const message = errorMessage(error);
		return toolResult(`Error: ${message}`, { tool, args, error: message });
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_shutdown", async () => {
		await (await runtimePromise)?.close();
		runtimePromise = undefined;
	});

	pi.registerTool({
		name: "mcp_search",
		label: "MCP Search",
		description:
			"Search mcporter MCP servers/tools by capability, name, description, or parameter. Multi-word queries return the closest partial matches.",
		parameters: McpSearchParams,
		async execute(_toolCallId, params) {
			return toolResult(await searchMcporter(params.query, params.limit), {
				query: params.query,
				limit: params.limit,
			});
		},
		renderCall(params, theme) {
			return new Text(formatSearchCall(params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});

	pi.registerTool({
		name: "mcp_inspect",
		label: "MCP Inspect",
		description:
			"Inspect a specific MCP server/tool/resource through mcporter. Prefer a tool selector for schemas; broad server output is truncated.",
		parameters: McpInspectParams,
		async execute(_toolCallId, params) {
			return inspectMcporter(params.target, params.mode, params.uri);
		},
		renderCall(params, theme) {
			return new Text(formatInspectCall(params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});

	pi.registerTool({
		name: "mcp_call",
		label: "MCP Call",
		description:
			"Call an MCP tool through mcporter with key=value params. Inspect the tool schema first when arguments are unknown.",
		parameters: McpCallParams,
		async execute(_toolCallId, params) {
			return callMcporter(params.tool, params.params ?? []);
		},
		renderCall(params, theme) {
			return new Text(formatCallCall(params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});
}
