import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	isToolCallEventType,
	parseFrontmatter,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const THINKING_LEVELS: ReadonlySet<string> = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && THINKING_LEVELS.has(value);
}

function hasConversation(ctx: ExtensionContext): boolean {
	return ctx.sessionManager.getBranch().some((entry) => {
		if (entry.type !== "message") return false;

		return entry.message.role === "user" || entry.message.role === "assistant";
	});
}

function getSkillPath(pi: ExtensionAPI, skillName: string): string | undefined {
	return pi
		.getCommands()
		.find((command) => command.source === "skill" && command.name === `skill:${skillName}`)
		?.sourceInfo.path;
}

function getSkillPathForRead(pi: ExtensionAPI, cwd: string, readPath: string): string | undefined {
	const normalizedReadPath = resolve(cwd, readPath.replace(/^@/, ""));

	return pi
		.getCommands()
		.filter((command) => command.source === "skill")
		.map((command) => command.sourceInfo.path)
		.find((skillPath) => resolve(skillPath) === normalizedReadPath);
}

function findAvailableModel(modelReference: string, ctx: ExtensionContext) {
	const availableModels = ctx.modelRegistry.getAvailable();
	const canonicalMatch = availableModels.find(
		(model) => `${model.provider}/${model.id}` === modelReference,
	);
	if (canonicalMatch) return canonicalMatch;

	const idMatches = availableModels.filter((model) => model.id === modelReference);
	if (idMatches.length > 0) {
		return idMatches.find((model) => ctx.modelRegistry.isUsingOAuth(model)) ?? idMatches[0];
	}

	const normalizedReference = modelReference.toLowerCase();
	const nameMatches = availableModels.filter(
		(model) => model.name?.toLowerCase() === normalizedReference,
	);
	if (nameMatches.length > 0) {
		return nameMatches.find((model) => ctx.modelRegistry.isUsingOAuth(model)) ?? nameMatches[0];
	}

	return undefined;
}

async function applySkillConfiguration(
	pi: ExtensionAPI,
	skillPath: string,
	ctx: ExtensionContext,
): Promise<void> {
	let frontmatter: Record<string, unknown>;

	try {
		const content = await readFile(skillPath, "utf8");
		frontmatter = parseFrontmatter(content).frontmatter;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Could not read skill configuration: ${message}`, "warning");
		return;
	}

	const configuredModel = frontmatter.model;
	const configuredEffort = frontmatter.effort;
	const applied: string[] = [];

	if (typeof configuredModel === "string" && configuredModel !== "inherit") {
		const model = findAvailableModel(configuredModel, ctx);

		if (model) {
			const modelWasSet = await pi.setModel(model);
			if (modelWasSet) {
				applied.push(`${model.provider}/${model.id}`);
			} else {
				ctx.ui.notify(`Skill model is unavailable: ${configuredModel}`, "warning");
			}
		} else {
			ctx.ui.notify(`Skill model is not configured: ${configuredModel}`, "warning");
		}
	}

	if (isThinkingLevel(configuredEffort)) {
		pi.setThinkingLevel(configuredEffort);
		applied.push(`effort:${pi.getThinkingLevel()}`);
	} else if (configuredEffort !== undefined) {
		ctx.ui.notify(`Unsupported skill effort: ${String(configuredEffort)}`, "warning");
	}

	if (applied.length > 0) {
		ctx.ui.notify(`Skill configuration: ${applied.join(" · ")}`, "info");
	}
}

export default function skillModelEffortExtension(pi: ExtensionAPI) {
	let detectFirstToolCall = false;

	pi.on("input", async (event, ctx) => {
		detectFirstToolCall = false;

		if (event.source === "extension" || event.streamingBehavior !== undefined || hasConversation(ctx)) {
			return { action: "continue" };
		}

		const skillCommand = event.text.match(/^\/skill:([^\s]+)(?:\s|$)/);
		if (skillCommand) {
			const skillName = skillCommand[1];
			const skillPath = getSkillPath(pi, skillName);

			if (skillPath) {
				await applySkillConfiguration(pi, skillPath, ctx);
			}

			return { action: "continue" };
		}

		detectFirstToolCall = true;
		return { action: "continue" };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!detectFirstToolCall) return;
		detectFirstToolCall = false;

		if (!isToolCallEventType("read", event)) return;

		const skillPath = getSkillPathForRead(pi, ctx.cwd, event.input.path);
		if (skillPath) {
			await applySkillConfiguration(pi, skillPath, ctx);
		}
	});

	pi.on("agent_end", () => {
		detectFirstToolCall = false;
	});
}
