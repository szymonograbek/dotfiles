import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const MCPORTER_TIMEOUT_MS = 30_000;
const MCPORTER_MAX_BUFFER = 1024 * 1024;

const McpSearchParams = Type.Object({
	query: Type.Optional(
		Type.String({
			description:
				"Case-insensitive capability/tool search. Omit to list available MCP servers.",
		}),
	),
});

const McpInspectParams = Type.Object({
	target: Type.String({
		description:
			"Server, tool selector, or resource server. Examples: 'atlassian', '44px.github_get_issue'.",
	}),
	mode: Type.Optional(
		Type.String({
			description: "One of: schema (default), brief, list, resource.",
		}),
	),
	uri: Type.Optional(
		Type.String({
			description: "Resource URI/path for mode=resource.",
		}),
	),
});

const McpCallParams = Type.Object({
	tool: Type.String({
		description: "Tool selector to call, e.g. 'server.tool_name'.",
	}),
	params: Type.Optional(
		Type.Array(
			Type.String({
				description: "mcporter CLI argument in key=value form.",
			}),
			{
				description:
					"Arguments passed to mcporter call as key=value strings. Use JSON strings for structured values if the target tool expects them.",
			},
		),
	),
});

type McporterResult = {
	readonly stdout: string;
	readonly stderr: string;
};

function readStringProperty(value: unknown, property: string): string | undefined {
	if (typeof value !== "object" || value === null || !(property in value)) return undefined;
	const record: Record<string, unknown> = value;
	const field = record[property];
	return typeof field === "string" ? field : undefined;
}

function getErrorText(error: unknown): string {
	const stderr = readStringProperty(error, "stderr");
	const stdout = readStringProperty(error, "stdout");
	const message = error instanceof Error ? error.message : "unknown error";
	return [stdout, stderr, message].filter((part) => part && part.trim()).join("\n");
}

async function runMcporter(args: readonly string[]): Promise<McporterResult> {
	try {
		const result = await execFileAsync("mcporter", [...args], {
			timeout: MCPORTER_TIMEOUT_MS,
			maxBuffer: MCPORTER_MAX_BUFFER,
		});
		return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
	} catch (error) {
		throw new Error(getErrorText(error));
	}
}

async function mcporterList(): Promise<string> {
	try {
		const result = await runMcporter(["list"]);
		return result.stdout;
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		return `mcporter list failed: ${message}`;
	}
}

function parseServerNames(listOutput: string): string[] {
	return listOutput
		.split("\n")
		.map((line) => /^-\s+([^\s(]+)/.exec(line)?.[1])
		.filter((name) => typeof name === "string");
}

function formatToolResult(text: string, details: unknown) {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

async function searchMcporter(query: string | undefined): Promise<string> {
	const list = await mcporterList();
	const normalizedQuery = query?.trim().toLowerCase();
	if (!normalizedQuery) return list;

	const serverNames = parseServerNames(list);
	const sections = await Promise.all(
		serverNames.map(async (serverName) => {
			try {
				const result = await runMcporter(["list", serverName, "--brief"]);
				const matches = result.stdout
					.split("\n")
					.filter((line) => line.toLowerCase().includes(normalizedQuery));
				return matches.length > 0 ? `## ${serverName}\n${matches.join("\n")}` : "";
			} catch (error) {
				const message = error instanceof Error ? error.message : "unknown error";
				return serverName.toLowerCase().includes(normalizedQuery)
					? `## ${serverName}\n${message}`
					: "";
			}
		}),
	);

	const matches = sections.filter((section) => section.length > 0);
	if (matches.length === 0) return `No mcporter tools matched '${query}'.\n\nServers:\n${list}`;
	return matches.join("\n\n");
}

function inspectArgs(target: string, mode: string | undefined, uri: string | undefined): string[] {
	const normalizedMode = mode?.trim().toLowerCase() || "schema";
	if (normalizedMode === "schema") return ["list", target, "--schema"];
	if (normalizedMode === "brief") return ["list", target, "--brief"];
	if (normalizedMode === "list") return ["list", target];
	if (normalizedMode === "resource") {
		return uri ? ["resource", target, uri] : ["resource", target];
	}
	return ["list", target, "--schema"];
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "mcp_search",
		label: "MCP Search",
		description:
			"Search mcporter MCP servers and brief tool lists. Use before concluding a capability is unavailable.",
		parameters: McpSearchParams,
		async execute(_toolCallId, params) {
			const text = await searchMcporter(params.query);
			return formatToolResult(text, { query: params.query });
		},
	});

	pi.registerTool({
		name: "mcp_inspect",
		label: "MCP Inspect",
		description:
			"Inspect an MCP server/tool/resource through mcporter. Gets schemas by default; use brief/list/resource modes when needed.",
		parameters: McpInspectParams,
		async execute(_toolCallId, params) {
			const args = inspectArgs(params.target, params.mode, params.uri);
			try {
				const result = await runMcporter(args);
				const text = result.stderr ? `${result.stdout}\n\nstderr:\n${result.stderr}` : result.stdout;
				return formatToolResult(text, { args });
			} catch (error) {
				const message = error instanceof Error ? error.message : "unknown error";
				return formatToolResult(`Error: ${message}`, { args, error: message });
			}
		},
	});

	pi.registerTool({
		name: "mcp_call",
		label: "MCP Call",
		description:
			"Call an MCP tool through mcporter with key=value params. Inspect the tool schema first when arguments are unknown.",
		parameters: McpCallParams,
		async execute(_toolCallId, params) {
			const args = ["call", params.tool, ...(params.params ?? [])];
			try {
				const result = await runMcporter(args);
				const text = result.stderr ? `${result.stdout}\n\nstderr:\n${result.stderr}` : result.stdout;
				return formatToolResult(text, { args });
			} catch (error) {
				const message = error instanceof Error ? error.message : "unknown error";
				return formatToolResult(`Error: ${message}`, { args, error: message });
			}
		},
	});

}
