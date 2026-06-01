import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

const MCPORTER_TIMEOUT_MS = 30_000;
const MCPORTER_MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;
const MAX_INSPECT_CHARS = 24_000;

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

type McporterResult = { readonly stdout: string; readonly stderr: string };
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

type FieldScores = { readonly name: number; readonly description: number; readonly params: number };

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

function errorText(error: unknown): string {
	const parts = [stringProperty(error, "stdout"), stringProperty(error, "stderr")];
	const message = error instanceof Error ? error.message : "unknown error";
	return [...parts, message].filter((part) => typeof part === "string" && part.trim().length > 0).join("\n");
}

async function runMcporter(args: readonly string[]): Promise<McporterResult> {
	try {
		const result = await execFileAsync("mcporter", [...args], {
			timeout: MCPORTER_TIMEOUT_MS,
			maxBuffer: MCPORTER_MAX_BUFFER,
		});
		return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
	} catch (error) {
		throw new Error(errorText(error));
	}
}

function toolResult(text: string, details: unknown) {
	return { content: [{ type: "text", text }], details };
}

function truncate(text: string, maxChars: number): string {
	return text.length <= maxChars
		? text
		: `${text.slice(0, maxChars)}\n\n…truncated ${text.length - maxChars} chars. Narrow the search or inspect a specific tool.`;
}

async function listServersText(): Promise<string> {
	try {
		return (await runMcporter(["list"])).stdout;
	} catch (error) {
		return `mcporter list failed: ${error instanceof Error ? error.message : "unknown error"}`;
	}
}

function serverNames(listOutput: string): string[] {
	return listOutput
		.split("\n")
		.map((line) => /^-\s+([^\s(]+)/.exec(line)?.[1])
		.filter((name): name is string => typeof name === "string");
}

function parseToolsJson(server: string, json: string): ToolSummary[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return [];
	}
	const tools = property(parsed, "tools");
	return Array.isArray(tools)
		? tools.flatMap((tool) => {
				const name = stringProperty(tool, "name");
				if (typeof name !== "string") return [];
				const description = stringProperty(tool, "description");
				const inputSchema = property(tool, "inputSchema");
				return [
					{
						server,
						name,
						description,
						inputSchemaText: typeof inputSchema === "undefined" ? undefined : JSON.stringify(inputSchema),
					},
				];
			})
		: [];
}

function parseToolsBrief(server: string, brief: string): ToolSummary[] {
	return brief.split("\n").flatMap((line) => {
		const match = /^\s*function\s+([^\s(]+)\((.*)\);/.exec(line);
		return match ? [{ server, name: match[1], inputSchemaText: match[2] }] : [];
	});
}

async function listServerTools(server: string): Promise<ToolSummary[]> {
	try {
		return parseToolsJson(server, (await runMcporter(["list", server, "--json"])).stdout);
	} catch {
		try {
			return parseToolsBrief(server, (await runMcporter(["list", server, "--brief"])).stdout);
		} catch {
			return [];
		}
	}
}

function tokenScore(fields: FieldScores): number {
	return Math.max(fields.name, fields.description, fields.params);
}

function matchedFields(fields: FieldScores): MatchedField[] {
	return [
		...(fields.name > 0 ? ["name"] : []),
		...(fields.description > 0 ? ["description"] : []),
		...(fields.params > 0 ? ["params"] : []),
	];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	return values.filter((value, index) => values.indexOf(value) === index);
}

function isSubsequence(needle: string, haystack: string): boolean {
	const chars = [...haystack];
	return [...needle].every((char) => {
		const index = chars.indexOf(char);
		if (index < 0) return false;
		chars.splice(0, index + 1);
		return true;
	});
}

function tokenMatchesWord(queryToken: string, word: string): boolean {
	if (word.includes(queryToken) || queryToken.includes(word)) return true;
	const shorter = queryToken.length <= word.length ? queryToken : word;
	const longer = queryToken.length <= word.length ? word : queryToken;
	return shorter.length >= 3 && shorter[0] === longer[0] && isSubsequence(shorter, longer);
}

function includesToken(text: string, token: string): boolean {
	return tokensOf(text).some((word) => tokenMatchesWord(token, word));
}

function fieldScores(token: string, tool: ToolSummary): FieldScores {
	const name = normalize(`${tool.server} ${tool.name}`);
	const description = normalize(tool.description ?? "");
	const params = normalize(tool.inputSchemaText ?? "");
	return {
		name: includesToken(name, token) ? 100 : 0,
		description: includesToken(description, token) ? 30 : 0,
		params: includesToken(params, token) ? 5 : 0,
	};
}

function uniqueFields(fields: readonly MatchedField[]): readonly MatchedField[] {
	return fields.filter((field, index) => fields.indexOf(field) === index);
}

function scoreTool(queryTokens: readonly string[], tool: ToolSummary): ScoredTool | undefined {
	const fieldMatches = queryTokens.map((token) => fieldScores(token, tool));
	const scores = fieldMatches.map(tokenScore);
	if (!scores.every((score) => score > 0)) return undefined;
	const strongMatches = fieldMatches.filter((fields) => fields.name > 0 || fields.description > 0).length;
	const score = strongMatches * 1_000 + scores.reduce((total, score) => total + score, 0);
	return {
		tool,
		score,
		matchedFields: uniqueFields(fieldMatches.flatMap(matchedFields)),
	};
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

	const tools = (await Promise.all(serverNames(list).map(listServerTools))).flat();
	const matches = tools
		.flatMap((tool) => scoreTool(queryTokens, tool) ?? [])
		.sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name));
	const shown = matches.slice(0, clampLimit(requestedLimit));

	if (shown.length === 0) {
		return `No mcporter tools matched '${query}'. Every query word must fuzzy-match the tool name, description, or parameters. Try fewer words.\n\nServers:\n${list}`;
	}

	const suffix = matches.length > shown.length ? `\n\nShowing top ${shown.length} of ${matches.length} matches. Narrow the query for a better result.` : "";
	return `${groupByServer(shown)}${suffix}`;
}

function inspectArgs(target: string, mode: string | undefined, uri: string | undefined): string[] {
	const normalizedMode = mode?.trim().toLowerCase() || "schema";
	if (normalizedMode === "brief") return ["list", target, "--brief"];
	if (normalizedMode === "list") return ["list", target];
	if (normalizedMode === "resource") return uri ? ["resource", target, uri] : ["resource", target];
	return ["list", target, "--schema"];
}

function isBroadServerInspect(target: string, mode: string | undefined): boolean {
	return (mode?.trim().toLowerCase() || "schema") === "schema" && !target.includes(".");
}

async function runTool(args: readonly string[]): Promise<ReturnType<typeof toolResult>> {
	try {
		const result = await runMcporter(args);
		const text = result.stderr ? `${result.stdout}\n\nstderr:\n${result.stderr}` : result.stdout;
		return toolResult(text, { args });
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		return toolResult(`Error: ${message}`, { args, error: message });
	}
}

export default function (pi: ExtensionAPI) {
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
	});

	pi.registerTool({
		name: "mcp_inspect",
		label: "MCP Inspect",
		description:
			"Inspect a specific MCP server/tool/resource through mcporter. Prefer a tool selector for schemas; broad server output is truncated.",
		parameters: McpInspectParams,
		async execute(_toolCallId, params) {
			if (isBroadServerInspect(params.target, params.mode)) {
				return toolResult(
					`Refusing broad schema dump for server '${params.target}' because it can consume too much context. Use mcp_search, then inspect a specific tool selector like '${params.target}.tool_name'.`,
					{ target: params.target, mode: params.mode },
				);
			}
			const args = inspectArgs(params.target, params.mode, params.uri);
			const result = await runTool(args);
			const text = result.content[0]?.text;
			return typeof text === "string" ? toolResult(truncate(text, MAX_INSPECT_CHARS), result.details) : result;
		},
	});

	pi.registerTool({
		name: "mcp_call",
		label: "MCP Call",
		description:
			"Call an MCP tool through mcporter with key=value params. Inspect the tool schema first when arguments are unknown.",
		parameters: McpCallParams,
		async execute(_toolCallId, params) {
			return runTool(["call", params.tool, ...(params.params ?? [])]);
		},
	});
}
