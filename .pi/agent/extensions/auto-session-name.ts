import { complete, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MAX_SESSION_NAME_LENGTH = 60;

function buildConversationNamingPrompt(conversation: string): string {
	return buildSessionNamingPrompt("this Pi session conversation", conversation);
}

function buildSessionNamingPrompt(sourceDescription: string, sourceText: string): string {
	return `Create a short, human-readable Pi session name for ${sourceDescription}.

Rules:
- Capture the user's intent/action, not just the topic
- Prefer verb-led names when the prompt asks to inspect, explain, debug, build, fix, refactor, or compare something
- Examples: "Explore Auto Session Name Extension", "Debug Login Redirect", "Refactor Billing Tests", "Compare Auth Providers"
- 3 to 7 words
- Title Case
- No quotes
- No punctuation unless necessary
- Return only the session name

Input:
${sourceText}`;
}

function normalizeSessionName(text: string): string | undefined {
	const firstLine = text
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);

	if (!firstLine) return undefined;

	const withoutWrapper = firstLine
		.replace(/^session name:\s*/i, "")
		.replace(/^title:\s*/i, "")
		.replace(/^["'`]+/, "")
		.replace(/["'`.]+$/, "")
		.trim();

	if (!withoutWrapper) return undefined;
	return withoutWrapper.slice(0, MAX_SESSION_NAME_LENGTH).trim();
}

function extractText(response: Awaited<ReturnType<typeof complete>>): string {
	return response.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function getConversationStats(ctx: ExtensionContext): { userMessages: number; assistantMessages: number } {
	const messages = ctx.sessionManager
		.getBranch()
		.flatMap((entry) => (entry.type === "message" ? [entry.message] : []))
		.filter((message) => message.role === "user" || message.role === "assistant");

	return {
		userMessages: messages.filter((message) => message.role === "user").length,
		assistantMessages: messages.filter((message) => message.role === "assistant").length,
	};
}

function isFirstConversationTurn(ctx: ExtensionContext): boolean {
	const stats = getConversationStats(ctx);
	return stats.userMessages <= 1 && stats.assistantMessages === 0;
}

function extractUserText(content: Message & { role: "user" }): string {
	if (typeof content.content === "string") return content.content;
	return content.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function extractAssistantText(content: Message & { role: "assistant" }): string {
	return content.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function buildConversationText(ctx: ExtensionContext): string {
	return ctx.sessionManager
		.getBranch()
		.flatMap((entry) => {
			if (entry.type !== "message") return [];

			const message = entry.message;
			if (message.role === "user") {
				const text = extractUserText(message);
				return text ? [`User: ${text}`] : [];
			}
			if (message.role === "assistant") {
				const text = extractAssistantText(message);
				return text ? [`Assistant: ${text}`] : [];
			}
			return [];
		})
		.join("\n\n");
}

async function generateSessionName(prompt: string, ctx: ExtensionContext): Promise<string | undefined> {
	const model = ctx.model;
	if (!model) {
		ctx.ui.notify("auto-session-name: no current model selected", "warning");
		return undefined;
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		ctx.ui.notify(`auto-session-name auth failed: ${auth.error}`, "warning");
		return undefined;
	}
	if (!auth.apiKey) {
		ctx.ui.notify(`auto-session-name: no API key for ${model.provider}/${model.id}`, "warning");
		return undefined;
	}

	const messages: Message[] = [
		{
			role: "user",
			content: [{ type: "text", text: prompt }],
			timestamp: Date.now(),
		},
	];

	const response = await complete(
		model,
		{ messages },
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			maxTokens: 512,
			cacheRetention: "none",
		},
	);

	if (response.stopReason === "error") {
		throw new Error(response.errorMessage ?? `empty error from ${response.provider}/${response.model}`);
	}

	const name = normalizeSessionName(extractText(response));
	if (!name) {
		const contentTypes = response.content.map((part) => part.type).join(", ") || "none";
		ctx.ui.notify(
			`auto-session-name: empty response from ${response.provider}/${response.model} (stop=${response.stopReason}, content=${contentTypes})`,
			"warning",
		);
	}
	return name;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI) {
	let attemptedForCurrentSession = false;

	pi.on("session_start", () => {
		attemptedForCurrentSession = false;
	});

	pi.registerCommand("auto-name", {
		description: "Rename session from conversation history (excluding tool calls/results)",
		handler: async (_args, ctx) => {
			const conversation = buildConversationText(ctx);
			if (!conversation.trim()) {
				ctx.ui.notify("auto-session-name: no conversation text found", "warning");
				return;
			}

			ctx.ui.notify("Generating session name...", "info");

			try {
				const sessionName = await generateSessionName(buildConversationNamingPrompt(conversation), ctx);
				if (!sessionName) {
					ctx.ui.notify("auto-session-name: model returned no name", "warning");
					return;
				}

				pi.setSessionName(sessionName);
				ctx.ui.notify(`Session named: ${sessionName}`, "info");
			} catch (error) {
				ctx.ui.notify(`auto-session-name failed: ${errorMessage(error)}`, "warning");
			}
		},
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "user") return;
		if (attemptedForCurrentSession) return;
		if (!isFirstConversationTurn(ctx)) return;

		const userText = extractUserText(event.message);
		const conversation = userText ? `User: ${userText}` : buildConversationText(ctx);
		if (!conversation.trim()) return;

		attemptedForCurrentSession = true;

		void generateSessionName(buildConversationNamingPrompt(conversation), ctx)
			.then((sessionName) => {
				if (!sessionName) return;
				pi.setSessionName(sessionName);
				ctx.ui.notify(`Session named: ${sessionName}`, "info");
			})
			.catch(() => undefined);
	});
}
