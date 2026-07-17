import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const LOOP_STATUS = "ticket-loop";

function usage(ctx: ExtensionCommandContext): void {
	ctx.ui.notify("Usage: /loop [START [END]]", "error");
}

function parseTicketNumber(value: string | undefined): number | undefined {
	if (value === undefined || !/^[0-9]+$/.test(value)) {
		return undefined;
	}

	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function finalAssistantResponse(ctx: ExtensionCommandContext): {
	text: string;
	stopReason: string;
} | undefined {
	const branch = ctx.sessionManager.getBranch();

	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") {
			continue;
		}

		const text = entry.message.content
			.filter((content) => content.type === "text")
			.map((content) => content.text)
			.join("\n");

		return { text, stopReason: entry.message.stopReason };
	}

	return undefined;
}

function isBlocked(text: string): boolean {
	return text.split("\n").slice(-20).some((line) => line.startsWith("BLOCKED:"));
}

function ticketPrompt(ticketNumber: number, ticketContent: string): string {
	const ticketFile = `tickets/${ticketNumber}.md`;

	return `Read and implement ${ticketFile}. Work only on this ticket; do not implement later tickets. Run relevant verification. Use your best judgement for minor ambiguities. Only if hard-blocked, end your response with a line starting exactly with BLOCKED:.

Contents of ${ticketFile}:

${ticketContent}`;
}

async function runTicketRange(
	ctx: ExtensionCommandContext,
	ticketNumber: number,
	end: number,
): Promise<void> {
	const ticketFile = `tickets/${ticketNumber}.md`;
	let ticketContent: string;

	try {
		ticketContent = await readFile(join(ctx.cwd, ticketFile), "utf8");
	} catch (error) {
		ctx.ui.setStatus(LOOP_STATUS, undefined);
		ctx.ui.notify(`Couldn’t read ${ticketFile} · ${errorMessage(error)}`, "error");
		return;
	}

	const parentSession = ctx.sessionManager.getSessionFile();
	const result = await ctx.newSession({
		parentSession,
		setup: async (sessionManager) => {
			sessionManager.appendSessionInfo(`ticket ${ticketNumber}`);
		},
		withSession: async (replacementCtx) => {
			replacementCtx.ui.setStatus(LOOP_STATUS, `Loop · Ticket ${ticketNumber} of ${end}`);
			replacementCtx.ui.notify(`Implementing Ticket ${ticketNumber} of ${end}`, "info");

			try {
				await replacementCtx.sendUserMessage(ticketPrompt(ticketNumber, ticketContent));
			} catch (error) {
				replacementCtx.ui.setStatus(LOOP_STATUS, undefined);
				replacementCtx.ui.notify(`Ticket ${ticketNumber} failed · ${errorMessage(error)}`, "error");
				return;
			}

			const response = finalAssistantResponse(replacementCtx);
			if (response === undefined) {
				replacementCtx.ui.setStatus(LOOP_STATUS, undefined);
				replacementCtx.ui.notify(`No assistant response for Ticket ${ticketNumber}`, "error");
				return;
			}

			if (response.stopReason === "aborted" || response.stopReason === "error") {
				replacementCtx.ui.setStatus(LOOP_STATUS, undefined);
				replacementCtx.ui.notify(`Stopped on Ticket ${ticketNumber} · ${response.stopReason}`, "error");
				return;
			}

			if (isBlocked(response.text)) {
				replacementCtx.ui.setStatus(LOOP_STATUS, undefined);
				replacementCtx.ui.notify(`Blocked on Ticket ${ticketNumber}`, "error");
				return;
			}

			if (ticketNumber === end) {
				replacementCtx.ui.setStatus(LOOP_STATUS, undefined);
				replacementCtx.ui.notify(`Loop Complete · Finished through Ticket ${end}`, "info");
				return;
			}

			await runTicketRange(replacementCtx, ticketNumber + 1, end);
		},
	});

	if (result.cancelled) {
		ctx.ui.setStatus(LOOP_STATUS, undefined);
		ctx.ui.notify(`New session cancelled before Ticket ${ticketNumber}`, "warning");
	}
}

export default function ticketLoopExtension(pi: ExtensionAPI): void {
	pi.registerCommand("loop", {
		description: "Implement numbered ticket files in clean sessions",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const values = args.trim() === "" ? [] : args.trim().split(/\s+/);
			if (values.length > 2) {
				usage(ctx);
				return;
			}

			let entries: Dirent[];
			try {
				entries = await readdir(join(ctx.cwd, "tickets"), { withFileTypes: true });
			} catch (error) {
				ctx.ui.notify(`Couldn’t read tickets/ · ${errorMessage(error)}`, "error");
				return;
			}

			const ticketNumbers = entries
				.filter((entry) => entry.isFile() && /^[0-9]+\.md$/.test(entry.name))
				.map((entry) => Number(entry.name.slice(0, -3)))
				.filter((number) => Number.isSafeInteger(number) && number > 0)
				.sort((left, right) => left - right);

			if (ticketNumbers.length === 0) {
				ctx.ui.notify("No numbered ticket files found in tickets/", "error");
				return;
			}

			const start = values.length >= 1 ? parseTicketNumber(values[0]) : 1;
			const end = values.length === 2 ? parseTicketNumber(values[1]) : ticketNumbers.at(-1);
			if (start === undefined || end === undefined) {
				ctx.ui.notify("Start and end must be positive ticket numbers", "error");
				return;
			}

			if (start > end) {
				ctx.ui.notify("Start must be less than or equal to end", "error");
				return;
			}

			await runTicketRange(ctx, start, end);
		},
	});
}
