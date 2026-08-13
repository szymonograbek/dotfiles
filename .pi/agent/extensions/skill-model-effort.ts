import { readFile } from "node:fs/promises";
import {
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

function getSkillPath(pi: ExtensionAPI, skillName: string): string | undefined {
	return pi
		.getCommands()
		.find((command) => command.source === "skill" && command.name === `skill:${skillName}`)
		?.sourceInfo.path;
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
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || event.streamingBehavior !== undefined) {
			return { action: "continue" };
		}

		const skillCommand = event.text.match(/^\/skill:([^\s]+)(?:\s|$)/);
		if (!skillCommand) return { action: "continue" };

		const skillPath = getSkillPath(pi, skillCommand[1]);
		if (skillPath) {
			await applySkillConfiguration(pi, skillPath, ctx);
		}

		return { action: "continue" };
	});
}
