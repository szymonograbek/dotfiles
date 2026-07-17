import { formatSize, truncateHead, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { createRecord } from "./agent-runtime.ts";
import { CHILD_ENV, registerChildLifecycle } from "./child-runtime.ts";
import { agentLabel, TOOL_NAME, truncateTask, type SubagentDetails, type SubagentRecord } from "./domain.ts";
import { SubagentOrchestrator } from "./orchestrator.ts";
import { buildRequests, subagentSchema, type SubagentInput } from "./requests.ts";
import { createProgressReporter, formatSubagentCall, renderCollapsedResult, renderExpandedResult } from "./rendering.ts";
import { SubagentStore } from "./store.ts";
import { HerdrTerminal } from "./terminal/herdr-terminal.ts";
import { StatusWidget, SubagentsModal } from "./ui.ts";

export default function (pi: ExtensionAPI) {
	if (process.env[CHILD_ENV] === "1") {
		registerChildLifecycle(pi);
		return;
	}

	const store = new SubagentStore();
	const terminal = new HerdrTerminal(pi, { workspaceId: process.env.HERDR_WORKSPACE_ID });
	const orchestrator = new SubagentOrchestrator(terminal, store, import.meta.url);
	const widget = new StatusWidget(store);
	const persist = (record: SubagentRecord | undefined): void => {
		if (record !== undefined) pi.appendEntry("subagent", record);
	};

	pi.on("session_start", (_event, ctx) => store.restore(ctx));
	pi.on("session_shutdown", async () => {
		widget.stop();
		await orchestrator.shutdown();
	});

	const showSubagents = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui") return;
		await ctx.ui.custom<void>((tui, theme, _keybindings, done) => new SubagentsModal(
			store,
			theme,
			(record) => {
				void (async () => {
					const surfaceId = record.terminalSurfaceId;
					const surfaceOpen = surfaceId === undefined ? false : await terminal.isOpen(surfaceId);
					if (surfaceId !== undefined && surfaceOpen) {
						await terminal.focus(surfaceId);
					} else {
						await orchestrator.openSession(record, ctx.cwd);
					}
					done(undefined);
				})().catch((error) => {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
					tui.requestRender();
				});
			},
			(record) => {
				const controller = store.controller(record.id);
				if (controller === undefined) {
					ctx.ui.notify("Only currently running subagents can be stopped.", "warning");
					return;
				}
				controller.abort();
				persist(store.update(record.id, { status: "stopped" }));
				ctx.ui.notify(`Stopped ${truncateTask(record.task)}`, "info");
				tui.requestRender();
			},
			() => done(undefined),
			() => tui.requestRender(),
		), {
			overlay: true,
			overlayOptions: { width: "85%", maxHeight: "85%", anchor: "center", margin: 1 },
		});
	};

	pi.registerCommand("subagents", { description: "Open the subagent manager", handler: async (_args, ctx) => showSubagents(ctx) });
	pi.registerShortcut("alt+s", { description: "Open the subagent manager", handler: async (ctx) => showSubagents(ctx) });

	pi.registerTool<typeof subagentSchema, SubagentDetails>({
		name: TOOL_NAME,
		label: "Run Subagent",
		description: "Delegate one or more tasks to isolated Pi processes in unfocused terminal surfaces. Open /subagents to inspect, interrupt, or chat with a running child. Surfaces close automatically after normal completion.",
		promptSnippet: "Delegate self-contained investigation, review, or research to isolated subagents",
		promptGuidelines: [
			"Use run_subagent when self-contained tasks can be delegated and only final answers are needed.",
			"Use agents to run multiple subagents in parallel; choose each agent's model and thinkingLevel based on task complexity.",
			"Pass the minimum allowedTools needed for the delegated task; run_subagent is always unavailable to subagents.",
		],
		parameters: subagentSchema,
		async execute(_toolCallId, params: SubagentInput, signal, onUpdate, ctx) {
			const records = buildRequests(params).map((request) => createRecord(request, ctx.cwd));
			for (const record of records) { store.upsert(record); persist(record); }
			widget.start(ctx);
			const updateProgress = createProgressReporter(records, onUpdate, (id) => store.get(id));
			const results = await Promise.all(records.map(async (record, index) => {
				const controller = new AbortController();
				store.setController(record.id, controller);
				if (signal?.aborted) {
					controller.abort();
				} else {
					signal?.addEventListener("abort", () => controller.abort(), { once: true });
				}
				try {
					const result = await orchestrator.run(record, ctx, controller.signal, updateProgress, index + 1, records.length);
					persist(store.get(record.id));
					return result;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const status = controller.signal.aborted ? "stopped" : "failed";
					persist(store.update(record.id, { status, error: message }));
					return `${agentLabel(index + 1, records.length)} ${status}: ${message}`;
				} finally {
					store.deleteController(record.id);
				}
			}));
			const fullText = results.length === 1 ? results.join("") : results.map((result, index) => `## Subagent ${index + 1}/${records.length}\n\n${result}`).join("\n\n");
			const truncation = truncateHead(fullText);
			const text = truncation.truncated
				? `${truncation.content}\n\n[Subagent output truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} shown. Full responses remain in subagent sessions and tool details.]`
				: fullText;
			const finalRecords = records.map((record) => store.get(record.id) ?? record);
			widget.refresh();
			return { content: [{ type: "text", text }], details: { agents: finalRecords } };
		},
		renderCall(params, theme) { return new Text(formatSubagentCall(params, theme), 0, 0); },
		renderResult(result, { expanded, isPartial }, theme) {
			return expanded ? renderExpandedResult(result, isPartial, theme) : renderCollapsedResult(result, isPartial, theme);
		},
	});
}
