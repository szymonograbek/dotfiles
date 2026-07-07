import { complete, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MAX_SESSION_NAME_LENGTH = 60;
const FOLLOW_UP_AUTO_RENAME_MESSAGE_COUNT = 5;

function buildConversationNamingPrompt(conversation: string): string {
	return buildSessionNamingPrompt("this Pi session conversation", conversation);
}

function buildSessionNamingPrompt(sourceDescription: string, sourceText: string): string {
	return `Create a short, human-readable Pi session name for ${sourceDescription}.

Rules:
- Capture the user's overarching intent across the whole conversation, not just the latest turn or final outcome
- Synthesize the main goal from all user requests and assistant work; ignore incidental detours unless they became the primary goal
- Capture the user's intent/action, not just the topic
- Prefer verb-led names when the conversation asks to inspect, explain, debug, build, fix, refactor, or compare something
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

function isToolCallAssistantMessage(message: Message & { role: "assistant" }): boolean {
	return message.stopReason === "toolUse" || message.content.some((part) => part.type === "toolCall");
}

function isCountableConversationMessage(message: Message & { role: "user" | "assistant" }): boolean {
	if (message.role === "user") return extractUserText(message).trim().length > 0;
	return !isToolCallAssistantMessage(message) && extractAssistantText(message).trim().length > 0;
}

interface ConversationStats {
	conversationMessages: number;
	userMessages: number;
	assistantMessages: number;
}

function getConversationStats(ctx: ExtensionContext): ConversationStats {
	const messages = ctx.sessionManager.getEntries().flatMap((entry) => {
		if (entry.type !== "message") return [];

		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") return [];
		return isCountableConversationMessage(message) ? [message] : [];
	});

	return {
		conversationMessages: messages.length,
		userMessages: messages.filter((message) => message.role === "user").length,
		assistantMessages: messages.filter((message) => message.role === "assistant").length,
	};
}

function hasConversationStarted(stats: ConversationStats): boolean {
	return stats.userMessages > 0 || stats.assistantMessages > 0;
}

function isFirstConversationTurn(ctx: ExtensionContext): boolean {
	const stats = getConversationStats(ctx);
	return stats.userMessages <= 1 && stats.assistantMessages === 0;
}

function buildConversationText(ctx: ExtensionContext): string {
	return ctx.sessionManager
		.getEntries()
		.flatMap((entry) => {
			if (entry.type !== "message") return [];

			const message = entry.message;
			if (message.role === "user") {
				const text = extractUserText(message);
				return text ? [`User: ${text}`] : [];
			}
			if (message.role === "assistant") {
				if (!isCountableConversationMessage(message)) return [];
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
	let attemptedInitialNameForCurrentSession = false;
	let attemptedFollowUpNameForCurrentSession = false;

	pi.on("session_start", (_event, ctx) => {
		const stats = getConversationStats(ctx);

		attemptedInitialNameForCurrentSession = hasConversationStarted(stats);
		attemptedFollowUpNameForCurrentSession = stats.conversationMessages >= FOLLOW_UP_AUTO_RENAME_MESSAGE_COUNT;
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
		if (event.message.role === "user" && !attemptedInitialNameForCurrentSession && isFirstConversationTurn(ctx)) {
			const userText = extractUserText(event.message);
			const conversation = userText ? `User: ${userText}` : buildConversationText(ctx);
			if (!conversation.trim()) return;

			attemptedInitialNameForCurrentSession = true;

			void generateSessionName(buildConversationNamingPrompt(conversation), ctx)
				.then((sessionName) => {
					if (!sessionName) return;
					pi.setSessionName(sessionName);
					ctx.ui.notify(`Session named: ${sessionName}`, "info");
				})
				.catch(() => undefined);
		}

		if (event.message.role !== "user" && event.message.role !== "assistant") return;
		if (!isCountableConversationMessage(event.message)) return;
		if (attemptedFollowUpNameForCurrentSession) return;
		if (getConversationStats(ctx).conversationMessages < FOLLOW_UP_AUTO_RENAME_MESSAGE_COUNT) return;

		const conversation = buildConversationText(ctx);
		if (!conversation.trim()) return;

		attemptedFollowUpNameForCurrentSession = true;

		void generateSessionName(buildConversationNamingPrompt(conversation), ctx)
			.then((sessionName) => {
				if (!sessionName) return;
				pi.setSessionName(sessionName);
				ctx.ui.notify(`Session renamed: ${sessionName}`, "info");
			})
			.catch(() => undefined);
	});
}
