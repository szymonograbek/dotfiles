import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import type { TextContent } from "@earendil-works/pi-ai";

type CodeBlock = {
	index: number;
	language: string;
	code: string;
};

type LastAssistantCodeBlocks = {
	blocks: CodeBlock[];
};

const fencePattern = /(^|\n)(```+)([^`\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g;

function extractCodeBlocks(markdown: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	let match: RegExpExecArray | null;

	while ((match = fencePattern.exec(markdown)) !== null) {
		const language = match[3].trim();
		const code = match[4];
		blocks.push({ index: blocks.length + 1, language, code });
	}

	return blocks;
}

function preview(code: string): string {
	const firstLine = code.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "empty block";
	return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function optionLabel(block: CodeBlock): string {
	const language = block.language ? ` (${block.language})` : "";
	return `#${block.index}${language}: ${preview(block.code)}`;
}

function textParts(content: readonly unknown[]): TextContent[] {
	const parts: TextContent[] = [];

	for (const part of content) {
		if (typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
			parts.push(part);
		}
	}

	return parts;
}

function commandHelp(): string {
	return "Usage: /copy-code [n]. With no n, opens a selector when multiple blocks are available.";
}

async function chooseCodeBlock(ctx: ExtensionContext, blocks: CodeBlock[]): Promise<CodeBlock | undefined> {
	if (blocks.length === 1) return blocks[0];

	const options = blocks.map(optionLabel);
	const selected = await ctx.ui.select("Copy which code block?", options);
	if (selected === undefined) return undefined;

	return blocks.find((block) => optionLabel(block) === selected);
}

async function copyCodeBlock(args: string, ctx: ExtensionContext, state: LastAssistantCodeBlocks): Promise<void> {
	if (state.blocks.length === 0) {
		ctx.ui.notify("No code blocks found in the last assistant message.", "warning");
		return;
	}

	const trimmed = args.trim();
	const requestedIndex = trimmed ? Number.parseInt(trimmed, 10) : undefined;

	if (requestedIndex !== undefined && (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > state.blocks.length)) {
		ctx.ui.notify(`${commandHelp()} Available: 1-${state.blocks.length}.`, "error");
		return;
	}

	const block = requestedIndex === undefined ? await chooseCodeBlock(ctx, state.blocks) : state.blocks[requestedIndex - 1];
	if (block === undefined) {
		ctx.ui.notify("Copy cancelled.", "info");
		return;
	}

	await copyToClipboard(block.code);
	ctx.ui.notify(`Copied code block #${block.index}${block.language ? ` (${block.language})` : ""}.`, "info");
}

export default function (pi: ExtensionAPI) {
	const lastAssistant: LastAssistantCodeBlocks = { blocks: [] };

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;

		const parts = textParts(event.message.content);
		const blocks = parts.flatMap((part) => extractCodeBlocks(part.text));
		lastAssistant.blocks = blocks.map((block, offset) => ({ ...block, index: offset + 1 }));
	});

	pi.registerCommand("copy-code", {
		description: "Copy a code block from the last assistant message. Usage: /copy-code [n]",
		handler: async (args, ctx) => {
			await copyCodeBlock(args, ctx, lastAssistant);
		},
	});
}
