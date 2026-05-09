import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PROMPT_CHARS = 8_000;

type CacheEntry = {
	readonly expiresAt: number;
	readonly text: string;
};

let cache: CacheEntry | undefined;

async function mcporterList(): Promise<string> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) return cache.text;

	try {
		const result = await execFileAsync("mcporter", ["list"], {
			timeout: 30_000,
			maxBuffer: 1024 * 1024,
		});
		const text = result.stdout.trim();
		cache = { expiresAt: now + CACHE_TTL_MS, text };
		return text;
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		const text = `mcporter list failed: ${message}`;
		cache = { expiresAt: now + CACHE_TTL_MS, text };
		return text;
	}
}

function truncateForPrompt(text: string): string {
	if (text.length <= MAX_PROMPT_CHARS) return text;
	return `${text.slice(0, MAX_PROMPT_CHARS)}\n... [truncated; run mcporter list <server> --schema for full tool docs]`;
}

export default function (pi: ExtensionAPI) {
	void mcporterList();

	pi.registerCommand("mcporter-reload", {
		description: "Refresh cached mcporter server discovery",
		handler: async (_args, ctx) => {
			cache = undefined;
			await mcporterList();
			ctx.ui.notify("Refreshed mcporter server discovery", "success");
		},
	});

	pi.on("session_start", () => {
		void mcporterList();
	});

	pi.on("before_agent_start", async (event) => {
		const list = truncateForPrompt(await mcporterList());

		return {
			systemPrompt: `${event.systemPrompt}\n\n## MCP servers available through mcporter\n\nUse the current snapshot below to answer questions about which MCP servers are available. Do not run \`mcporter list\` just to enumerate MCPs. Use mcporter commands only when you need fresh details, tool schemas, resources, or to call a relevant tool.\n\nCommands:\n- Discover servers: \`mcporter list\`\n- Inspect tools for a server only when relevant: \`mcporter list <server> --schema\`\n- Call a tool: \`mcporter call <server>.<tool> key=value ...\`\n- List/read resources: \`mcporter resource <server> [uri]\`\n\nCurrent server snapshot, intentionally without tool schemas to keep the prompt small:\n\`\`\`\n${list}\n\`\`\``,
		};
	});
}
