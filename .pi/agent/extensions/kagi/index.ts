import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const KAGI_API_BASE_URL = "https://kagi.com/api/v1";
const KAGI_API_KEY_ENV = "KAGI_API_KEY";

type SearchParams = {
	readonly query: string;
	readonly limit?: number;
	readonly extractCount?: number;
};

type ExtractParams = {
	readonly urls: readonly string[];
};

const SearchParameters = Type.Object({
	query: Type.String({ description: "Search query." }),
	limit: Type.Optional(
		Type.Number({ description: "Maximum number of search results to return. Must be between 1 and 1024." }),
	),
	extractCount: Type.Optional(
		Type.Number({
			description: "Extract markdown for this many top search results. Must be between 1 and 10. Incurs Kagi Extract API cost.",
		}),
	),
});

const ExtractParameters = Type.Object({
	urls: Type.Array(
		Type.String({ description: "HTTP(S) URL to extract as markdown." }),
		{
			description: "Up to 10 HTTP(S) URLs.",
			minItems: 1,
			maxItems: 10,
		},
	),
});

function getApiKey(): string {
	const apiKey = process.env[KAGI_API_KEY_ENV]?.trim();
	if (!apiKey) throw new Error(`Missing ${KAGI_API_KEY_ENV} environment variable.`);
	return apiKey;
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? "null";
}

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

function quoted(text: string): string {
	return `"${text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function formatSearchCall(params: unknown, theme: { fg(color: "toolTitle" | "accent", text: string): string; bold(text: string): string }): string {
	const query = stringProperty(params, "query")?.trim();
	const title = theme.fg("toolTitle", theme.bold("Kagi Search"));
	return query && query.length > 0 ? `${title} ${theme.fg("accent", quoted(query))}` : title;
}

function formatExtractCall(params: unknown, theme: { fg(color: "toolTitle" | "accent", text: string): string; bold(text: string): string }): string {
	const urls = stringArrayProperty(params, "urls") ?? [];
	const title = theme.fg("toolTitle", theme.bold("Kagi Extract"));
	return urls.length > 0 ? `${title} ${theme.fg("accent", urls.map(quoted).join(", "))}` : title;
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
	theme: { fg(color: "toolOutput" | "muted", text: string): string },
): Text {
	const text = textContent(result);
	return new Text(text ? theme.fg("toolOutput", text) : isPartial ? theme.fg("muted", "Running…") : "", 0, 0);
}

async function callKagi(path: "/search" | "/extract", body: unknown, signal: AbortSignal | undefined): Promise<unknown> {
	const response = await fetch(`${KAGI_API_BASE_URL}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${getApiKey()}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal,
	});

	const text = await response.text();
	let payload: unknown = text;
	if (text.trim()) {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = text;
		}
	}

	if (!response.ok) {
		throw new Error(`Kagi API ${response.status} ${response.statusText}: ${formatJson(payload)}`);
	}

	return payload;
}

function buildSearchBody(params: SearchParams): { query: string; limit?: number; extract?: { count: number } } {
	const body: { query: string; limit?: number; extract?: { count: number } } = { query: params.query };
	if (typeof params.limit === "number") body.limit = params.limit;
	if (typeof params.extractCount === "number") body.extract = { count: params.extractCount };
	return body;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "kagi_search",
		label: "Kagi Search",
		description: "Search the web using Kagi's Search API. Reads the API key from KAGI_API_KEY.",
		promptSnippet: "Search the web through Kagi's premium search API",
		promptGuidelines: ["Use kagi_search when the user needs current web search results from Kagi."],
		parameters: SearchParameters,
		async execute(_toolCallId, params: SearchParams, signal) {
			const result = await callKagi("/search", buildSearchBody(params), signal);
			return {
				content: [{ type: "text", text: formatJson(result) }],
				details: result,
			};
		},
		renderCall(params, theme) {
			return new Text(formatSearchCall(params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});

	pi.registerTool({
		name: "kagi_extract",
		label: "Kagi Extract",
		description: "Extract markdown content from up to 10 URLs using Kagi's Extract API. Reads the API key from KAGI_API_KEY.",
		promptSnippet: "Extract markdown page content from URLs through Kagi",
		promptGuidelines: ["Use kagi_extract when the user wants readable markdown content from one or more URLs."],
		parameters: ExtractParameters,
		async execute(_toolCallId, params: ExtractParams, signal) {
			const result = await callKagi("/extract", { pages: params.urls.map((url) => ({ url })) }, signal);
			return {
				content: [{ type: "text", text: formatJson(result) }],
				details: result,
			};
		},
		renderCall(params, theme) {
			return new Text(formatExtractCall(params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});
}
