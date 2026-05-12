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

export default function cmuxExtension(pi: ExtensionAPI) {
	let startedAt: number | undefined;

	pi.on("agent_start", () => {
		startedAt = Date.now();
	});

	pi.on("agent_end", async (_event, ctx) => {
		const durationMs = startedAt ? Date.now() - startedAt : 0;
		startedAt = undefined;

		if (!(await shouldNotify(durationMs))) return;
		await notifyCmux(buildNotification(pi, ctx, durationMs));
	});

	pi.registerCommand("cmux-test", {
		description: "Send a test notification through cmux",
		handler: async (_args, ctx) => {
			const focus = await getFocusState();
			const sent = await notifyCmux({
				title: "Pi cmux test",
				body: `Cmux notifications are configured for ${path.basename(ctx.cwd) || ctx.cwd}. Focus: ${formatFocusState(focus)}.`,
			});
			ctx.ui.notify(sent ? "Sent cmux notification" : "cmux is not available", sent ? "success" : "warning");
		},
	});
}

type CmuxNotification = {
	readonly title: string;
	readonly subtitle?: string;
	readonly body: string;
};

type FocusState = "focused" | "unfocused" | "unknown";

type CmuxResponse =
	| { readonly ok: true; readonly result: unknown }
	| { readonly ok: false };

function buildNotification(pi: ExtensionAPI, ctx: ExtensionContext, durationMs: number): CmuxNotification {
	const sessionName = pi.getSessionName();
	const cwdName = path.basename(ctx.cwd) || ctx.cwd;
	return {
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

async function notifyViaSocket(notification: CmuxNotification): Promise<boolean> {
	return (await cmuxRequest("notification.create", notification)).ok;
}

async function notifyViaCli(notification: CmuxNotification): Promise<boolean> {
	const args = ["notify", "--title", notification.title, "--body", notification.body];
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

function formatFocusState(focus: FocusState): string {
	if (focus === "focused") return "focused";
	if (focus === "unfocused") return "not focused";
	return "unknown";
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
