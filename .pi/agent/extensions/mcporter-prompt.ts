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
			systemPrompt: `${event.systemPrompt}\n\n<mcporter>\n## MCP servers available through mcporter\n\nUse the current snapshot below to answer questions about which MCP **servers** are available. Do not run \`mcporter list\` just to re-enumerate servers.\n\n### Server names ≠ capabilities — always grep before saying "no"\n\n**Critical:** A server name does not tell you what integrations or capabilities live inside it. A single server can aggregate many sub-services (Stripe, PostHog, GitHub, Jira, BigQuery, …) under namespaced tool prefixes. The snapshot only lists server names and tool counts — it is NOT a list of supported integrations.\n\nWhenever the user asks whether some capability/integration/product (e.g. "do we have access to X?", "can we call Y?") is available, you MUST grep the brief tool list of every server with a non-trivial tool count before answering. Do not answer "no" based on server names alone.\n\n\`\`\`\nmcporter list <server> --brief | grep -i <keyword>\n\`\`\`\n\n### Context budget — avoid dumping every tool\n\nServers can expose hundreds of tools; running \`mcporter list <server> --schema\` on a large one will blow the context window. For any server with more than ~30 tools, filter down before fetching schemas:\n\n1. Grep \`--brief\` (as above) to find candidate tool names.\n2. Fetch the schema for just the tool(s) you need via the dotted selector (wildcards are not supported):\n   \`mcporter list <server>.<tool> --schema\`\n3. Only use \`mcporter list <server> --schema\` for small servers where the full dump is cheap.\n\nOther commands:\n- Discover servers: \`mcporter list\`\n- Call a tool: \`mcporter call <server>.<tool> key=value ...\`\n- List/read resources: \`mcporter resource <server> [uri]\`\n\nCurrent server snapshot (counts only, no tool schemas):\n\`\`\`\n${list}\n\`\`\`\n</mcporter>`,
		};
	});
}
