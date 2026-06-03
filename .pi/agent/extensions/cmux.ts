import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_SOCKET_PATH = "/tmp/cmux.sock";
const NOTIFY_TIMEOUT_MS = 2_000;
const DEFAULT_MIN_DURATION_MS = 30_000;
const MIN_DURATION_ENV = "CMUX_PI_NOTIFY_MIN_SECONDS";
const STATUS_KEY = "pi";
const IDLE_SETTLE_MS = 1_500;
const CMUX_WORKSPACE_ENV = "CMUX_WORKSPACE_ID";
const CMUX_SURFACE_ENV = "CMUX_SURFACE_ID";
const TAB_TITLE_MAX_LENGTH = 40;

export default function cmuxExtension(pi: ExtensionAPI) {
	let startedAt: number | undefined;
	let runId = 0;
	let completionTimer: ReturnType<typeof setTimeout> | undefined;
	let tabRenamed = false;

	const clearCompletionTimer = () => {
		if (!completionTimer) return;
		clearTimeout(completionTimer);
		completionTimer = undefined;
	};

	const scheduleCompletion = (ctx: ExtensionContext, durationMs: number, completedRunId: number) => {
		clearCompletionTimer();
		completionTimer = setTimeout(() => {
			completionTimer = undefined;
			if (completedRunId !== runId) return;

			const state = readAgentState(ctx);
			if (!state) return;
			if (!state.idle || state.hasPendingMessages) {
				scheduleCompletion(ctx, durationMs, completedRunId);
				return;
			}

			void setCmuxStatus("idle");
			void notifyWhenNeeded(pi, ctx, durationMs);
		}, IDLE_SETTLE_MS);
		completionTimer.unref?.();
	};

	pi.on("session_start", () => {
		tabRenamed = false;
		void setCmuxStatus("idle");
	});

	pi.on("before_agent_start", (event) => {
		if (tabRenamed) return;
		const title = formatTabTitle(event.prompt);
		if (!title) return;
		tabRenamed = true;
		void renameCmuxTab(title);
	});

	pi.on("agent_start", () => {
		runId += 1;
		clearCompletionTimer();
		startedAt = Date.now();
		void setCmuxStatus("working");
	});

	pi.on("agent_end", (_event, ctx) => {
		const durationMs = startedAt ? Date.now() - startedAt : 0;
		startedAt = undefined;
		scheduleCompletion(ctx, durationMs, runId);
	});

	pi.on("session_shutdown", async () => {
		clearCompletionTimer();
		await Promise.all([clearCmuxStatus(), clearCmuxTabName()]);
	});
}

function formatTabTitle(prompt: string): string | null {
	const collapsed = prompt.replace(/\s+/g, " ").trim();
	if (!collapsed) return null;
	if (collapsed.length <= TAB_TITLE_MAX_LENGTH) return collapsed;
	return `${collapsed.slice(0, TAB_TITLE_MAX_LENGTH - 1).trimEnd()}\u2026`;
}

async function renameCmuxTab(title: string): Promise<boolean> {
	return (await cmuxRequest("tab.action", tabActionParams("rename", title))).ok;
}

async function clearCmuxTabName(): Promise<boolean> {
	return (await cmuxRequest("tab.action", tabActionParams("clear-name"))).ok;
}

function tabActionParams(action: "rename" | "clear-name", title?: string): Record<string, unknown> {
	const target = getCmuxTarget();
	return {
		action,
		title,
		workspace: target.workspaceId,
		surface: target.surfaceId,
	};
}

type CmuxTarget = {
	readonly workspaceId?: string;
	readonly surfaceId?: string;
};

type AgentState = {
	readonly idle: boolean;
	readonly hasPendingMessages: boolean;
};

type CmuxNotification = CmuxTarget & {
	readonly title: string;
	readonly subtitle?: string;
	readonly body: string;
};

type FocusState = "focused" | "unfocused" | "unknown";
type CmuxStatus = "working" | "idle";

type CmuxResponse =
	| { readonly ok: true; readonly result: unknown }
	| { readonly ok: false };

function readAgentState(ctx: ExtensionContext): AgentState | null {
	try {
		return {
			idle: ctx.isIdle(),
			hasPendingMessages: ctx.hasPendingMessages(),
		};
	} catch {
		return null;
	}
}

async function notifyWhenNeeded(pi: ExtensionAPI, ctx: ExtensionContext, durationMs: number): Promise<void> {
	try {
		if (!(await shouldNotify(durationMs))) return;
		await notifyCmux(buildNotification(pi, ctx, durationMs));
	} catch {
		// Extension contexts can become stale after session replacement/reload.
	}
}

function buildNotification(pi: ExtensionAPI, ctx: ExtensionContext, durationMs: number): CmuxNotification {
	const sessionName = pi.getSessionName();
	const cwdName = path.basename(ctx.cwd) || ctx.cwd;
	return {
		...getCmuxTarget(),
		title: "Pi done",
		subtitle: sessionName || undefined,
		body: `Agent stopped working in ${cwdName} after ${formatDuration(durationMs)}.`,
	};
}

async function shouldNotify(durationMs: number): Promise<boolean> {
	const focus = await getFocusState();
	if (focus === "unfocused") return true;
	return durationMs >= getMinDurationMs();
}

async function getFocusState(): Promise<FocusState> {
	const result = await cmuxRequest("system.identify", {});
	const state = result.ok ? readFocusState(result.result) : "unknown";
	if (state !== "unknown") return state;
	return readFocusState(await identifyViaCli());
}

function readFocusState(value: unknown): FocusState {
	const record = asRecord(value);
	const caller = asRecord(record?.caller);
	const focused = asRecord(record?.focused);
	const callerSurface = readString(caller?.surface_ref) || readString(caller?.surface_id);
	const focusedSurface = readString(focused?.surface_ref) || readString(focused?.surface_id);
	if (!callerSurface || !focusedSurface) return "unknown";
	return callerSurface === focusedSurface ? "focused" : "unfocused";
}

async function identifyViaCli(): Promise<unknown> {
	try {
		const result = await execFileAsync("cmux", ["identify", "--json"], { timeout: NOTIFY_TIMEOUT_MS });
		return JSON.parse(result.stdout);
	} catch {
		return undefined;
	}
}

async function notifyCmux(notification: CmuxNotification): Promise<boolean> {
	if (await notifyViaSocket(notification)) return true;
	return notifyViaCli(notification);
}

async function setCmuxStatus(status: CmuxStatus): Promise<boolean> {
	const label = status === "working" ? "working" : "idle";
	const icon = status === "working" ? "hammer" : "circle";
	const color = status === "working" ? "#ff9500" : "#34c759";
	try {
		await execFileAsync("cmux", ["set-status", STATUS_KEY, label, "--icon", icon, "--color", color, ...targetCliArgs(getCmuxTarget())], {
			timeout: NOTIFY_TIMEOUT_MS,
		});
		return true;
	} catch {
		return false;
	}
}

async function clearCmuxStatus(): Promise<boolean> {
	try {
		await execFileAsync("cmux", ["clear-status", STATUS_KEY, ...targetCliArgs(getCmuxTarget())], { timeout: NOTIFY_TIMEOUT_MS });
		return true;
	} catch {
		return false;
	}
}

async function notifyViaSocket(notification: CmuxNotification): Promise<boolean> {
	return (await cmuxRequest("notification.create", notificationParams(notification))).ok;
}

async function notifyViaCli(notification: CmuxNotification): Promise<boolean> {
	const args = ["notify", "--title", notification.title, "--body", notification.body, ...targetCliArgs(notification)];
	if (notification.subtitle) args.splice(3, 0, "--subtitle", notification.subtitle);

	try {
		await execFileAsync("cmux", args, { timeout: NOTIFY_TIMEOUT_MS });
		return true;
	} catch {
		return false;
	}
}

async function cmuxRequest(method: string, params: Record<string, unknown>): Promise<CmuxResponse> {
	const socketPath = getSocketPath();
	if (!(await isSocket(socketPath))) return { ok: false };

	const request = {
		id: `pi-${Date.now()}`,
		method,
		params,
	};

	return sendSocketRequest(socketPath, `${JSON.stringify(request)}\n`);
}

function getSocketPath(): string {
	const configured = process.env.CMUX_SOCKET_PATH?.trim();
	return configured || DEFAULT_SOCKET_PATH;
}

function getCmuxTarget(): CmuxTarget {
	return {
		workspaceId: readString(process.env[CMUX_WORKSPACE_ENV]) || undefined,
		surfaceId: readString(process.env[CMUX_SURFACE_ENV]) || undefined,
	};
}

function targetCliArgs(target: CmuxTarget): string[] {
	const args: string[] = [];
	if (target.workspaceId) args.push("--workspace", target.workspaceId);
	if (target.surfaceId) args.push("--surface", target.surfaceId);
	return args;
}

function notificationParams(notification: CmuxNotification): Record<string, unknown> {
	return {
		title: notification.title,
		subtitle: notification.subtitle,
		body: notification.body,
		workspace_id: notification.workspaceId,
		surface_id: notification.surfaceId,
	};
}

async function isSocket(socketPath: string): Promise<boolean> {
	try {
		return (await stat(socketPath)).isSocket();
	} catch {
		return false;
	}
}

function sendSocketRequest(socketPath: string, payload: string): Promise<CmuxResponse> {
	return new Promise((resolve) => {
		let settled = false;
		let response = "";
		const socket = net.createConnection(socketPath);

		const settle = (result: CmuxResponse) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(result);
		};

		socket.setTimeout(NOTIFY_TIMEOUT_MS, () => settle({ ok: false }));
		socket.once("error", () => settle({ ok: false }));
		socket.once("close", () => settle({ ok: false }));
		socket.on("data", (chunk) => {
			response += chunk.toString("utf8");
			const line = response.split("\n", 1)[0];
			if (line) settle(parseCmuxResponse(line));
		});
		socket.once("connect", () => {
			socket.write(payload);
		});
	});
}

function parseCmuxResponse(text: string): CmuxResponse {
	try {
		const parsed: unknown = JSON.parse(text);
		const record = asRecord(parsed);
		return record?.ok === true ? { ok: true, result: record.result } : { ok: false };
	} catch {
		return { ok: false };
	}
}

function getMinDurationMs(): number {
	const configured = Number(process.env[MIN_DURATION_ENV]);
	if (!Number.isFinite(configured) || configured < 0) return DEFAULT_MIN_DURATION_MS;
	return configured * 1000;
}

function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds}s`;
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
