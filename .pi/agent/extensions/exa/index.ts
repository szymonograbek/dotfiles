import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Exa, type AnswerOptions, type ContentsOptions, type DeepOutputSchema, type RegularSearchOptions, type SectionTag, type VerbosityOptions } from "exa-js";
import { Type } from "typebox";

const EXA_API_KEY_ENV = "EXA_API_KEY";

const SearchType = StringEnum(["auto", "fast", "instant", "deep-lite", "deep", "deep-reasoning"], {
	description: "Search method. Defaults to auto.",
	default: "auto",
});

const Category = StringEnum(["company", "people", "research paper", "news", "personal site", "financial report", "pdf"], {
	description: "Optional content category. company/people do not support excludeDomains or date filters.",
});

const TextVerbosity = StringEnum(["compact", "standard", "full"], {
	description: "Text extraction verbosity. Defaults to compact.",
	default: "compact",
});

const PageSection = StringEnum(["header", "navigation", "banner", "body", "sidebar", "footer", "metadata"], {
	description: "Page section name for includeSections/excludeSections.",
});

const TextOptions = Type.Object({
	maxCharacters: Type.Optional(Type.Integer({ description: "Hard cap on returned text characters." })),
	includeHtmlTags: Type.Optional(Type.Boolean({ description: "Preserve HTML tags in extracted text." })),
	verbosity: Type.Optional(TextVerbosity),
	includeSections: Type.Optional(Type.Array(PageSection, { description: "Only include these page sections." })),
	excludeSections: Type.Optional(Type.Array(PageSection, { description: "Exclude these page sections." })),
});

const HighlightsOptions = Type.Object({
	query: Type.Optional(Type.String({ description: "Custom query to guide highlight selection." })),
	maxCharacters: Type.Optional(Type.Integer({ description: "Cap total highlight characters per URL." })),
});

const SummaryOptions = Type.Object({
	query: Type.Optional(Type.String({ description: "Custom query to guide the summary." })),
	schema: Type.Optional(Type.Unknown({ description: "JSON schema for per-result structured summary output." })),
});

const ExtrasOptions = Type.Object({
	links: Type.Optional(Type.Integer({ description: "Number of URLs to extract from each page.", minimum: 0 })),
	imageLinks: Type.Optional(Type.Integer({ description: "Number of image URLs to extract from each page.", minimum: 0 })),
});

const SearchContentsOptions = Type.Object({
	text: Type.Optional(Type.Union([Type.Boolean(), TextOptions], { description: "Return full page text. Set maxCharacters when requesting text." })),
	highlights: Type.Optional(Type.Union([Type.Boolean(), HighlightsOptions], { description: "Return relevant excerpts. Prefer true for agent workflows." })),
	summary: Type.Optional(Type.Union([Type.Boolean(), SummaryOptions], { description: "Return an LLM-generated summary per result." })),
	maxAgeHours: Type.Optional(Type.Integer({ description: "Content freshness. 0 always livecrawls; -1 cache only; omit for default.", minimum: -1, maximum: 720 })),
	livecrawlTimeout: Type.Optional(Type.Integer({ description: "Livecrawl timeout in milliseconds.", minimum: 1, maximum: 90000 })),
	subpages: Type.Optional(Type.Integer({ description: "Number of subpages to crawl per result.", minimum: 0, maximum: 100 })),
	subpageTarget: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Keywords to prioritize when selecting subpages." })),
	extras: Type.Optional(ExtrasOptions),
});

const SearchParameters = Type.Object({
	query: Type.String({ description: "Natural language search query." }),
	type: Type.Optional(SearchType),
	stream: Type.Optional(Type.Boolean({ description: "If true, returns SSE chunks instead of one JSON response. Usually leave false for Pi tools." })),
	numResults: Type.Optional(Type.Integer({ description: "Number of results to return. Must be 1-100.", minimum: 1, maximum: 100 })),
	category: Type.Optional(Category),
	userLocation: Type.Optional(Type.String({ description: "Two-letter ISO country code, e.g. US." })),
	includeDomains: Type.Optional(Type.Array(Type.String(), { description: "Only return results from these domains. Max 1200." })),
	excludeDomains: Type.Optional(Type.Array(Type.String(), { description: "Exclude these domains. Do not use with category company or people." })),
	startPublishedDate: Type.Optional(Type.String({ description: "ISO 8601 lower publication date bound. Do not use with category company or people." })),
	endPublishedDate: Type.Optional(Type.String({ description: "ISO 8601 upper publication date bound. Do not use with category company or people." })),
	moderation: Type.Optional(Type.Boolean({ description: "Filter unsafe content from results." })),
	additionalQueries: Type.Optional(Type.Array(Type.String(), { description: "Extra query variations for deep-lite, deep, and deep-reasoning." })),
	systemPrompt: Type.Optional(Type.String({ description: "Instructions for synthesized output and deep-search planning." })),
	outputSchema: Type.Optional(Type.Unknown({ description: "JSON schema for synthesized output.content. Works on every search type." })),
	contents: Type.Optional(SearchContentsOptions),
});

const ContentsParameters = Type.Object({
	urls: Type.Array(Type.String({ description: "HTTP(S) URL or Exa document ID." }), {
		description: "Known URLs or document IDs to retrieve.",
		minItems: 1,
		maxItems: 100,
	}),
	text: Type.Optional(Type.Union([Type.Boolean(), TextOptions], { description: "Return full page text. Set maxCharacters when requesting text." })),
	highlights: Type.Optional(Type.Union([Type.Boolean(), HighlightsOptions], { description: "Return relevant excerpts." })),
	summary: Type.Optional(Type.Union([Type.Boolean(), SummaryOptions], { description: "Return an LLM-generated summary per URL." })),
	maxAgeHours: Type.Optional(Type.Integer({ description: "Content freshness. 0 always livecrawls; -1 cache only; omit for default.", minimum: -1, maximum: 720 })),
	livecrawlTimeout: Type.Optional(Type.Integer({ description: "Livecrawl timeout in milliseconds.", minimum: 1, maximum: 90000 })),
	subpages: Type.Optional(Type.Integer({ description: "Number of subpages to crawl.", minimum: 0, maximum: 100 })),
	subpageTarget: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Keywords to prioritize when selecting subpages." })),
	extras: Type.Optional(ExtrasOptions),
});

const AnswerParameters = Type.Object({
	query: Type.String({ description: "Natural-language question or instructions." }),
	stream: Type.Optional(Type.Boolean({ description: "If true, returns SSE chunks instead of one JSON response. Usually leave false for Pi tools." })),
	text: Type.Optional(Type.Boolean({ description: "If true, return full citation page text." })),
	systemPrompt: Type.Optional(Type.String({ description: "A system prompt to guide answer generation." })),
	userLocation: Type.Optional(Type.String({ description: "Two-letter ISO country code, e.g. US." })),
	outputSchema: Type.Optional(Type.Unknown({ description: "JSON schema for structured answer output." })),
});

type SearchKind = "auto" | "fast" | "instant" | "deep-lite" | "deep" | "deep-reasoning";
type ExaCategory = "company" | "people" | "research paper" | "news" | "personal site" | "financial report" | "pdf";

type TextParams = {
	readonly maxCharacters?: number;
	readonly includeHtmlTags?: boolean;
	readonly verbosity?: string;
	readonly includeSections?: readonly string[];
	readonly excludeSections?: readonly string[];
};

type HighlightsParams = {
	readonly query?: string;
	readonly maxCharacters?: number;
};

type SummaryParams = {
	readonly query?: string;
	readonly schema?: unknown;
};

type ExtrasParams = {
	readonly links?: number;
	readonly imageLinks?: number;
};

type ContentsParams = {
	readonly text?: boolean | TextParams;
	readonly highlights?: boolean | HighlightsParams;
	readonly summary?: boolean | SummaryParams;
	readonly maxAgeHours?: number;
	readonly livecrawlTimeout?: number;
	readonly subpages?: number;
	readonly subpageTarget?: string | readonly string[];
	readonly extras?: ExtrasParams;
};

type SearchParams = {
	readonly query: string;
	readonly type?: string;
	readonly stream?: boolean;
	readonly numResults?: number;
	readonly category?: string;
	readonly userLocation?: string;
	readonly includeDomains?: readonly string[];
	readonly excludeDomains?: readonly string[];
	readonly startPublishedDate?: string;
	readonly endPublishedDate?: string;
	readonly moderation?: boolean;
	readonly additionalQueries?: readonly string[];
	readonly systemPrompt?: string;
	readonly outputSchema?: unknown;
	readonly contents?: ContentsParams;
};

type GetContentsParams = ContentsParams & {
	readonly urls: readonly string[];
};

type AnswerParams = {
	readonly query: string;
	readonly stream?: boolean;
	readonly text?: boolean;
	readonly systemPrompt?: string;
	readonly userLocation?: string;
	readonly outputSchema?: unknown;
};

function getExaClient(): Exa {
	const apiKey = process.env[EXA_API_KEY_ENV]?.trim();
	if (!apiKey) throw new Error(`Missing ${EXA_API_KEY_ENV} environment variable.`);
	return new Exa(apiKey);
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

function formatQueryCall(
	label: string,
	params: unknown,
	theme: { fg(color: "toolTitle" | "accent", text: string): string; bold(text: string): string },
): string {
	const query = stringProperty(params, "query")?.trim();
	const title = theme.fg("toolTitle", theme.bold(label));
	return query && query.length > 0 ? `${title} ${theme.fg("accent", quoted(query))}` : title;
}

function formatContentsCall(params: unknown, theme: { fg(color: "toolTitle" | "accent", text: string): string; bold(text: string): string }): string {
	const urls = stringArrayProperty(params, "urls") ?? [];
	const title = theme.fg("toolTitle", theme.bold("Exa Contents"));
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: readonly string[] | undefined): string[] | undefined {
	return value === undefined ? undefined : [...value];
}

function isVerbosity(value: string | undefined): value is VerbosityOptions | undefined {
	return value === undefined || value === "compact" || value === "standard" || value === "full";
}

function sectionTag(value: string, field: string): SectionTag {
	if (value === "header") return value;
	if (value === "navigation") return value;
	if (value === "banner") return value;
	if (value === "body") return value;
	if (value === "sidebar") return value;
	if (value === "footer") return value;
	if (value === "metadata") return value;
	throw new Error(`${field} contains unsupported section: ${value}`);
}

function pageSections(value: readonly string[] | undefined, field: string): SectionTag[] | undefined {
	return value === undefined ? undefined : value.map((item) => sectionTag(item, field));
}

function searchKind(value: string | undefined): SearchKind {
	if (value === undefined) return "auto";
	if (value === "auto" || value === "fast" || value === "instant" || value === "deep-lite" || value === "deep" || value === "deep-reasoning") return value;
	throw new Error(`Unsupported Exa search type: ${value}`);
}

function exaCategory(value: string | undefined): ExaCategory | undefined {
	if (value === undefined) return undefined;
	if (value === "company" || value === "people" || value === "research paper" || value === "news" || value === "personal site" || value === "financial report" || value === "pdf") return value;
	throw new Error(`Unsupported Exa category: ${value}`);
}

function textOptions(value: boolean | TextParams | undefined): ContentsOptions["text"] | undefined {
	if (value === undefined || value === false) return undefined;
	if (value === true) return true;
	if (!isVerbosity(value.verbosity)) throw new Error(`Unsupported text verbosity: ${value.verbosity}`);
	return {
		maxCharacters: value.maxCharacters,
		includeHtmlTags: value.includeHtmlTags,
		verbosity: value.verbosity,
		includeSections: pageSections(value.includeSections, "text.includeSections"),
		excludeSections: pageSections(value.excludeSections, "text.excludeSections"),
	};
}

function highlightsOptions(value: boolean | HighlightsParams | undefined): ContentsOptions["highlights"] | undefined {
	if (value === undefined || value === false) return undefined;
	if (value === true) return true;
	return { query: value.query, maxCharacters: value.maxCharacters };
}

function summaryOptions(value: boolean | SummaryParams | undefined): ContentsOptions["summary"] | undefined {
	if (value === undefined || value === false) return undefined;
	if (value === true) return true;
	return { query: value.query, schema: schemaRecord(value.schema, "summary.schema") };
}

function schemaRecord(value: unknown, field: string): Record<string, unknown> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error(`${field} must be a JSON object.`);
	return value;
}

function deepOutputSchema(value: unknown): DeepOutputSchema | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw new Error("outputSchema must be a JSON object.");
	if (value.type === "text") {
		return {
			type: "text",
			description: typeof value.description === "string" ? value.description : undefined,
		};
	}
	if (value.type === "object") {
		return {
			type: "object",
			properties: schemaRecord(value.properties, "outputSchema.properties"),
			required: Array.isArray(value.required) ? value.required.filter((item) => typeof item === "string") : undefined,
		};
	}
	throw new Error('outputSchema.type must be "text" or "object".');
}

function buildContentsOptions(params: ContentsParams | undefined, defaultHighlights: boolean): ContentsOptions {
	const contents: ContentsOptions = {
		text: textOptions(params?.text),
		highlights: highlightsOptions(params?.highlights),
		summary: summaryOptions(params?.summary),
		maxAgeHours: params?.maxAgeHours,
		livecrawlTimeout: params?.livecrawlTimeout,
		subpages: params?.subpages,
		subpageTarget: typeof params?.subpageTarget === "string" ? params.subpageTarget : stringArray(params?.subpageTarget),
		extras: params?.extras,
	};

	if (defaultHighlights && contents.text === undefined && contents.highlights === undefined && contents.summary === undefined) {
		contents.highlights = true;
	}

	return contents;
}

function buildSearchOptions(params: SearchParams): RegularSearchOptions {
	const type = searchKind(params.type);
	const shared = {
		numResults: params.numResults,
		category: exaCategory(params.category),
		userLocation: params.userLocation,
		includeDomains: stringArray(params.includeDomains),
		excludeDomains: stringArray(params.excludeDomains),
		startPublishedDate: params.startPublishedDate,
		endPublishedDate: params.endPublishedDate,
		moderation: params.moderation,
		systemPrompt: params.systemPrompt,
		outputSchema: deepOutputSchema(params.outputSchema),
		contents: buildContentsOptions(params.contents, true),
	};

	if (type === "deep-lite" || type === "deep" || type === "deep-reasoning") {
		return { ...shared, type, additionalQueries: stringArray(params.additionalQueries) };
	}

	return { ...shared, type };
}

function buildAnswerOptions(params: AnswerParams): AnswerOptions {
	return {
		stream: params.stream,
		text: params.text,
		systemPrompt: params.systemPrompt,
		userLocation: params.userLocation,
		outputSchema: schemaRecord(params.outputSchema, "outputSchema"),
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "exa_search",
		label: "Exa Search",
		description: "Search the web with Exa AI when you need raw results, source discovery, docs lookup, comparisons, or retrieval control. Defaults to type=auto and contents.highlights=true.",
		promptSnippet: "Search the web with Exa AI and retrieve raw results with highlights, text, summaries, or structured grounded output",
		promptGuidelines: [
			"Use exa_search for raw web results, documentation lookup, source discovery, comparisons across sources, or grounded structured extraction through Exa AI.",
			"For simple factual questions that ask for an answer, prefer exa_answer over exa_search unless you need to inspect raw results.",
			"For exa_search, prefer type=auto and contents.highlights=true unless the task needs low latency, deep synthesis, or full text.",
			"For exa_search, put text, highlights, summary, and maxAgeHours inside contents; never use deprecated useAutoprompt, includeUrls, excludeUrls, numSentences, highlightsPerUrl, tokensNum, or livecrawl.",
		],
		parameters: SearchParameters,
		async execute(_toolCallId, params: SearchParams) {
			const result = await getExaClient().search(params.query, buildSearchOptions(params));
			return {
				content: [{ type: "text", text: formatJson(result) }],
				details: result,
			};
		},
		renderCall(params, theme) {
			return new Text(formatQueryCall("Exa Search", params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});

	pi.registerTool({
		name: "exa_contents",
		label: "Exa Contents",
		description: "Get clean parsed content for known URLs or Exa document IDs. Defaults to highlights=true.",
		promptSnippet: "Extract Exa contents for known URLs or Exa document IDs",
		promptGuidelines: [
			"Use exa_contents when URLs are already known and you need highlights, text, summaries, or fresh content extraction from Exa AI.",
			"For exa_contents, content options are top-level; set text.maxCharacters when requesting full text to control token cost.",
		],
		parameters: ContentsParameters,
		async execute(_toolCallId, params: GetContentsParams) {
			const result = await getExaClient().getContents([...params.urls], buildContentsOptions(params, true));
			return {
				content: [{ type: "text", text: formatJson(result) }],
				details: result,
			};
		},
		renderCall(params, theme) {
			return new Text(formatContentsCall(params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});

	pi.registerTool({
		name: "exa_answer",
		label: "Exa Answer",
		description: "Ask Exa for a direct grounded answer with citations. Best for simple factual/current questions like latest versions, prices, dates, definitions, or 'what is...' queries.",
		promptSnippet: "Answer a question directly with grounded citations from Exa AI",
		promptGuidelines: [
			"Use exa_answer for direct user questions that need a concise grounded answer with citations, especially current factual lookups like latest software versions, prices, dates, definitions, or status.",
			"Use exa_search instead when you need raw result inspection, multiple sources to compare, documentation/source discovery, or structured search output with retrieval control.",
		],
		parameters: AnswerParameters,
		async execute(_toolCallId, params: AnswerParams) {
			const result = await getExaClient().answer(params.query, buildAnswerOptions(params));
			return {
				content: [{ type: "text", text: formatJson(result) }],
				details: result,
			};
		},
		renderCall(params, theme) {
			return new Text(formatQueryCall("Exa Answer", params, theme), 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult();
		},
	});
}
