import Fuse from "fuse.js";
import { createRuntime } from "mcporter";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type AgentToolResult,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { Runtime } from "mcporter";

const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;
const MAX_INSPECT_CHARS = 24_000;
const MAX_INLINE_VALUE_CHARS = 4_096;

const McpSearchParams = Type.Object({
	query: Type.Optional(
		Type.String({
			description:
				"Search MCP servers/tools by capability, name, description, or parameter. Omit to list servers.",
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

function formatSearchCall(params: unknown): string {
	const query = stringProperty(params, "query");
	return typeof query === "string" && query.trim().length > 0 ? `mcp_search ${quoted(query)}` : "mcp_search";
}

function formatInspectCall(params: unknown): string {
	const target = stringProperty(params, "target");
	const parts = ["mcp_inspect", ...(typeof target === "string" ? [quoted(target)] : [])];
	const mode = stringProperty(params, "mode");
	const uri = stringProperty(params, "uri");
	if (typeof mode === "string") parts.push(`mode=${quoted(mode)}`);
	if (typeof uri === "string") parts.push(`uri=${quoted(uri)}`);
	return parts.join(" ");
}

function formatCallCall(params: unknown): string {
	const tool = stringProperty(params, "tool");
	const args = stringArrayProperty(params, "params")?.join(" ");
	const parts = ["mcp_call", ...(typeof tool === "string" ? [quoted(tool)] : []), ...(args ? [args] : [])];
	return parts.join(" ");
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
): Text {
	const text = textContent(result);
	return new Text(text || (isPartial ? "Running…" : ""), 0, 0);
}

function truncate(text: string, maxChars: number): string {
	return text.length <= maxChars
		? text
		: `${text.slice(0, maxChars)}\n\n…truncated ${text.length - maxChars} chars. Narrow the search or inspect a specific tool.`;
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, undefined, 2);
	} catch {
		return String(value);
	}
}

type PreparedValue = {
	readonly value: unknown;
	readonly omittedLargeValues: number;
};

function prepareToolValue(value: unknown): PreparedValue {
	if (typeof value === "string" && value.length > MAX_INLINE_VALUE_CHARS) {
		return {
			value: `[omitted large value: ${formatSize(Buffer.byteLength(value, "utf8"))}]`,
			omittedLargeValues: 1,
		};
	}
	if (Array.isArray(value)) {
		const prepared = value.map(prepareToolValue);
		return {
			value: prepared.map((item) => item.value),
			omittedLargeValues: prepared.reduce((total, item) => total + item.omittedLargeValues, 0),
		};
	}
	if (typeof value === "object" && value !== null) {
		const prepared = Object.entries(value).map(([key, entry]) => ({ key, prepared: prepareToolValue(entry) }));
		return {
			value: prepared.reduce<Record<string, unknown>>(
				(acc, entry) => ({ ...acc, [entry.key]: entry.prepared.value }),
				{},
			),
			omittedLargeValues: prepared.reduce((total, entry) => total + entry.prepared.omittedLargeValues, 0),
		};
	}
	return { value, omittedLargeValues: 0 };
}

function stringifyToolOutput(value: unknown): PreparedValue {
	const prepared = prepareToolValue(value);
	return { value: stringify(prepared.value), omittedLargeValues: prepared.omittedLargeValues };
}

function truncateToolOutput(value: unknown): string {
	const prepared = stringifyToolOutput(value);
	const content = typeof prepared.value === "string" ? prepared.value : stringify(prepared.value);
	const truncation = truncateHead(content, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});
	const notices: string[] = [];
	if (prepared.omittedLargeValues > 0) {
		notices.push(`Output truncated because it was too long: omitted ${prepared.omittedLargeValues} large value(s).`);
	}
	if (truncation.truncated) {
		notices.push(
			`Output truncated because it was too long: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`,
		);
	}
	return notices.length === 0 ? truncation.content : `${truncation.content}\n\n[${notices.join(" ")}]`;
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

function containsToken(text: string, token: string): boolean {
	return tokensOf(text).some((word) => word.includes(token));
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

function fuseTokenMatches(token: string, documents: readonly SearchDocument[]): Map<string, TokenMatch> {
	const exactMatches = new Map(
		documents.flatMap((document) => {
			const match = exactTokenMatch(token, document);
			return match ? [[document.id, match]] : [];
		}),
	);
	if (exactMatches.size > 0 || token.length < 3) return exactMatches;

	const fuse = new Fuse(documents, {
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

	for (const result of fuse.search(token)) {
		const fields = fieldsFromFuse(result.matches);
		if (fields.length === 0) continue;
		const fuzzyScore = Math.round((1 - (result.score ?? FUSE_THRESHOLD)) * 100);
		const fieldBoost = fields.reduce((total, field) => {
			if (field === "name") return total + 180;
			if (field === "description") return total + 55;
			return total + 8;
		}, 0);
		const previous = exactMatches.get(result.item.id);
		const next = {
			score: Math.max(previous?.score ?? 0, fuzzyScore + fieldBoost),
			matchedFields: uniqueFields([...(previous?.matchedFields ?? []), ...fields]),
		};
		exactMatches.set(result.item.id, next);
	}

	return exactMatches;
}

function scoreTools(queryTokens: readonly string[], tools: readonly ToolSummary[]): ScoredTool[] {
	const documents = tools.map(toSearchDocument);
	const tokenMatches = queryTokens.map((token) => fuseTokenMatches(token, documents));
	return documents.flatMap((document) => {
		const matches = tokenMatches.map((matches) => matches.get(document.id));
		if (!matches.every((match) => typeof match !== "undefined")) return [];
		return [
			{
				tool: document,
				score: matches.reduce((total, match) => total + (match?.score ?? 0), 0),
				matchedFields: uniqueFields(matches.flatMap((match) => match?.matchedFields ?? [])),
			},
		];
	});
}

function firstLine(text: string | undefined): string | undefined {
	return text?.split("\n").find((line) => line.trim().length > 0)?.trim();
}

function formatMatch({ tool, matchedFields }: ScoredTool): string {
	const description = firstLine(tool.description);
	const matchText = ` _(matched: ${matchedFields.join(", ")})_`;
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

async function searchMcporter(query: string | undefined, requestedLimit: number | undefined): Promise<string> {
	const list = await listServersText();
	const queryTokens = tokensOf(query ?? "");
	if (queryTokens.length === 0) {
		return `${list}\n\nTip: call mcp_search with capability words to search tool names, descriptions, and parameters.`;
	}

	const tools = (await Promise.all((await serverNames()).map(listServerTools))).flat();
	const matches = scoreTools(queryTokens, tools).sort(
		(left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
	);
	const shown = matches.slice(0, clampLimit(requestedLimit));

	if (shown.length === 0) {
		return `No mcporter tools matched '${query}'. Every query word must fuzzy-match the tool name, description, or parameters. Try fewer words.\n\nServers:\n${list}`;
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
			return toolResult(truncate(stringify(result), MAX_INSPECT_CHARS), { target, mode, uri });
		}

		const selector = splitToolSelector(target);
		const server = selector?.server ?? target;
		const tools = await listServerTools(server);
		if (selector) {
			const found = tools.find((tool) => tool.name === selector.toolName);
			if (!found) return toolResult(`No tool found for '${target}'.`, { target, mode });
			return toolResult(truncate(stringify(found), MAX_INSPECT_CHARS), { target, mode });
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
		return toolResult(truncateToolOutput(result), { tool, server: selector.server, toolName: selector.toolName, args });
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
			"Search mcporter MCP servers. Every query word must fuzzy-match a tool name, description, or parameter.",
		parameters: McpSearchParams,
		async execute(_toolCallId, params) {
			return toolResult(await searchMcporter(params.query, params.limit), {
				query: params.query,
				limit: params.limit,
			});
		},
		renderCall(params, theme) {
			return new Text(theme.fg("toolTitle", theme.bold(formatSearchCall(params))), 0, 0);
		},
		renderResult(result, { expanded, isPartial }) {
			return expanded ? renderExpandedResult(result, isPartial) : renderCollapsedResult();
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
			return new Text(theme.fg("toolTitle", theme.bold(formatInspectCall(params))), 0, 0);
		},
		renderResult(result, { expanded, isPartial }) {
			return expanded ? renderExpandedResult(result, isPartial) : renderCollapsedResult();
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
			return new Text(theme.fg("toolTitle", theme.bold(formatCallCall(params))), 0, 0);
		},
		renderResult(result, { expanded, isPartial }) {
			return expanded ? renderExpandedResult(result, isPartial) : renderCollapsedResult();
		},
	});
}
