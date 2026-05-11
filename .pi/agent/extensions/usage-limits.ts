import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type UsageWindow = {
	used_percent?: number | null;
	reset_after_seconds?: number | null;
	reset_at?: number | null;
};

type RateLimitBucket = {
	allowed?: boolean;
	limit_reached?: boolean;
	primary_window?: UsageWindow | null;
};

type CodexUsageResponse = {
	rate_limit?: RateLimitBucket | null;
	additional_rate_limits?: Record<string, unknown> | unknown[] | null;
};

type UsageSnapshot = {
	fiveHourUsedPercent: number | null;
	fiveHourResetSeconds: number | null;
	isLimited: boolean;
};

type ClaudeUsageWindow = {
	usedPercent: number | null;
	resetSeconds: number | null;
};

type ClaudeUsageSnapshot = {
	fiveHour: ClaudeUsageWindow | null;
	sevenDay: ClaudeUsageWindow | null;
	isLimited: boolean;
};

type ClaudeOAuthUsageResponse = {
	five_hour?: unknown;
	seven_day?: unknown;
};

type ClaudeOAuthTokens = {
	claudeAiOauth?: unknown;
};

type AuthEntry = {
	type?: unknown;
	access?: unknown;
	accountId?: unknown;
	account_id?: unknown;
};

type UsageLimitsFile = {
	claudeOAuth?: unknown;
};

type CachedClaudeUsage = {
	fetchedAt?: unknown;
	fiveHour?: unknown;
	sevenDay?: unknown;
};

const EXTENSION_ID = "usage-limits";
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
const AUTH_FILE = join(AGENT_DIR, "auth.json");
const USAGE_LIMITS_FILE = join(AGENT_DIR, "usage-limits.json");
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";
const REFRESH_INTERVAL_MS = 60_000;
const CLAUDE_USAGE_CACHE_MS = 60_000;
const UNKNOWN = "--";

let claudeUsageCache: { fetchedAt: number; value: ClaudeUsageSnapshot | null } | null = null;

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let activeCtx: ExtensionContext | undefined;
	let refreshing = false;
	let queued = false;

	const refresh = async (ctx: ExtensionContext) => {
		activeCtx = ctx;
		if (!ctx.hasUI) return;
		if (refreshing) {
			queued = true;
			return;
		}

		refreshing = true;
		try {
			const [codex, claude] = await Promise.all([readCodexUsage(), readClaudeUsage()]);
			ctx.ui.setStatus(EXTENSION_ID, formatStatus(ctx, codex, claude));
		} catch (error) {
			ctx.ui.setStatus(EXTENSION_ID, ctx.ui.theme.fg("warning", `Usage unavailable: ${formatError(error)}`));
		} finally {
			refreshing = false;
			if (queued && activeCtx) {
				queued = false;
				void refresh(activeCtx);
			}
		}
	};

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setStatus(EXTENSION_ID, ctx.ui.theme.fg("dim", "Usage loading…"));
		void refresh(ctx);
		if (timer) clearInterval(timer);
		timer = setInterval(() => {
			if (activeCtx) void refresh(activeCtx);
		}, REFRESH_INTERVAL_MS);
		timer.unref?.();
	});

	pi.on("turn_end", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus(EXTENSION_ID, undefined);
		if (timer) clearInterval(timer);
		timer = undefined;
		activeCtx = undefined;
	});

	pi.registerCommand("usage-limits", {
		description: "Refresh Codex and Claude Code account limits",
		handler: async (_args, ctx) => {
			await refresh(ctx);
		},
	});
}

async function readCodexUsage(): Promise<UsageSnapshot | null> {
	const credentials = await loadCodexCredentials();
	if (!credentials) return null;

	const response = await fetch(CODEX_USAGE_URL, {
		headers: {
			accept: "*/*",
			authorization: `Bearer ${credentials.accessToken}`,
			"chatgpt-account-id": credentials.accountId,
		},
	});
	if (!response.ok) throw new Error(`Codex ${response.status}`);

	const data = await response.json();
	return parseCodexUsage(data);
}

async function loadCodexCredentials(): Promise<{ accessToken: string; accountId: string } | null> {
	const parsed = asRecord(await readJson(AUTH_FILE));
	const entry = asAuthEntry(parsed?.["openai-codex"]);
	if (!entry || entry.type !== "oauth") return null;

	const accessToken = typeof entry.access === "string" ? entry.access.trim() : "";
	const accountIdValue = typeof entry.accountId === "string" ? entry.accountId : entry.account_id;
	const accountId = typeof accountIdValue === "string" ? accountIdValue.trim() : "";
	if (!accessToken || !accountId) return null;
	return { accessToken, accountId };
}

function parseCodexUsage(value: unknown): UsageSnapshot | null {
	const response = asCodexUsageResponse(value);
	const bucket = asRateLimitBucket(response?.rate_limit);
	if (!bucket) return null;
	const fiveHour = bucket.primary_window;
	return {
		fiveHourUsedPercent: readPercent(fiveHour?.used_percent),
		fiveHourResetSeconds: readResetSeconds(fiveHour),
		isLimited: bucket.limit_reached === true || bucket.allowed === false,
	};
}

async function readClaudeUsage(): Promise<ClaudeUsageSnapshot | null> {
	return readClaudeOAuthUsage();
}

async function readClaudeOAuthUsage(): Promise<ClaudeUsageSnapshot | null> {
	if (claudeUsageCache && Date.now() - claudeUsageCache.fetchedAt < CLAUDE_USAGE_CACHE_MS) return claudeUsageCache.value;
	const fileCache = await readClaudeOAuthUsageFileCache();
	if (fileCache && Date.now() - fileCache.fetchedAt < CLAUDE_USAGE_CACHE_MS) {
		claudeUsageCache = fileCache;
		return fileCache.value;
	}

	const accessTokens = await loadClaudeCodeAccessTokens();
	let lastStatus: number | null = null;
	for (const accessToken of accessTokens) {
		const response = await fetch(CLAUDE_USAGE_URL, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${accessToken}`,
				"anthropic-beta": CLAUDE_OAUTH_BETA,
				"content-type": "application/json",
				"user-agent": "claude-code/usage-limits",
			},
		});
		if (response.ok) {
			const value = parseClaudeOAuthUsage(await response.json());
			claudeUsageCache = { fetchedAt: Date.now(), value };
			await writeClaudeOAuthUsageFileCache(value);
			return value;
		}
		lastStatus = response.status;
	}
	if (lastStatus !== null) throw new Error(`Claude ${lastStatus}`);
	claudeUsageCache = { fetchedAt: Date.now(), value: null };
	return null;
}

async function readClaudeOAuthUsageFileCache(): Promise<{ fetchedAt: number; value: ClaudeUsageSnapshot | null } | null> {
	const file = asUsageLimitsFile(await readJson(USAGE_LIMITS_FILE));
	const cached = asCachedClaudeUsage(file?.claudeOAuth);
	if (!cached) return null;
	const fetchedAt = readTimestampMs(cached.fetchedAt);
	if (fetchedAt === null) return null;
	const fiveHour = readClaudeUsageWindow(cached.fiveHour);
	const sevenDay = readClaudeUsageWindow(cached.sevenDay);
	if (!fiveHour && !sevenDay) return { fetchedAt, value: null };
	return {
		fetchedAt,
		value: {
			fiveHour,
			sevenDay,
			isLimited: isWindowLimited(fiveHour) || isWindowLimited(sevenDay),
		},
	};
}

async function writeClaudeOAuthUsageFileCache(value: ClaudeUsageSnapshot | null): Promise<void> {
	const root: Record<string, unknown> = asRecord(await readJson(USAGE_LIMITS_FILE)) ?? {};
	root.claudeOAuth = {
		fetchedAt: new Date().toISOString(),
		fiveHour: serializeClaudeUsageWindow(value?.fiveHour ?? null),
		sevenDay: serializeClaudeUsageWindow(value?.sevenDay ?? null),
	};
	await fs.mkdir(AGENT_DIR, { recursive: true });
	await fs.writeFile(USAGE_LIMITS_FILE, `${JSON.stringify(root, null, 2)}\n`, "utf8");
}

function formatStatus(ctx: ExtensionContext, codex: UsageSnapshot | null, claude: ClaudeUsageSnapshot | null): string {
	const theme = ctx.ui.theme;
	const codexLabel = codex?.isLimited ? theme.fg("error", "Codex") : theme.fg("dim", "Codex");
	const codexText = codex
		? formatProviderWindow(theme, codexLabel, codex.fiveHourUsedPercent, codex.fiveHourResetSeconds)
		: `${theme.fg("dim", "Codex")} ${theme.fg("muted", UNKNOWN)}`;
	const claudeLabel = claude?.isLimited ? theme.fg("error", "Claude") : theme.fg("dim", "Claude");
	const claudeText = claude?.fiveHour
		? formatProviderWindow(theme, claudeLabel, claude.fiveHour.usedPercent, claude.fiveHour.resetSeconds)
		: `${theme.fg("dim", "Claude")} ${theme.fg("muted", UNKNOWN)}`;
	return `${codexText} ${theme.fg("muted", "│")} ${claudeText}`;
}

function formatProviderWindow(
	theme: ExtensionContext["ui"]["theme"],
	label: string,
	usedPercent: number | null,
	resetSeconds: number | null,
): string {
	const reset = formatReset(theme, resetSeconds);
	return `${label} ${theme.fg("dim", "(5h)")} ${formatPercent(theme, usedPercent)}${reset ? ` ${reset}` : ""}`;
}

function formatPercent(theme: ExtensionContext["ui"]["theme"], value: number | null): string {
	if (value === null) return theme.fg("muted", UNKNOWN);
	const text = `${Math.round(value)}%`;
	if (value >= 90) return theme.fg("error", text);
	if (value >= 75) return theme.fg("warning", text);
	return theme.fg("success", text);
}

function formatReset(theme: ExtensionContext["ui"]["theme"], seconds: number | null): string {
	const text = formatResetCountdown(seconds);
	return text ? theme.fg("muted", text) : "";
}

function formatResetCountdown(seconds: number | null): string | null {
	if (seconds === null) return null;
	const total = Math.max(0, Math.round(seconds));
	const days = Math.floor(total / 86_400);
	const hours = Math.floor((total % 86_400) / 3_600);
	const minutes = Math.floor((total % 3_600) / 60);
	if (days > 0) return `${days}d${hours}h`;
	if (hours > 0) return `${hours}h${minutes}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${total % 60}s`;
}

function readResetSeconds(window: UsageWindow | null | undefined): number | null {
	if (!window) return null;
	const resetAfterSeconds = readNumber(window.reset_after_seconds);
	if (resetAfterSeconds !== null) return resetAfterSeconds;
	const resetAt = readNumber(window.reset_at);
	if (resetAt === null) return null;
	const resetAtSeconds = resetAt > 100_000_000_000 ? resetAt / 1000 : resetAt;
	return Math.max(0, resetAtSeconds - Date.now() / 1000);
}

function parseClaudeOAuthUsage(value: unknown): ClaudeUsageSnapshot | null {
	const response = asClaudeOAuthUsageResponse(value);
	if (!response) return null;
	const fiveHour = readClaudeOAuthUsageWindow(response.five_hour);
	const sevenDay = readClaudeOAuthUsageWindow(response.seven_day);
	if (!fiveHour && !sevenDay) return null;
	return {
		fiveHour,
		sevenDay,
		isLimited: isWindowLimited(fiveHour) || isWindowLimited(sevenDay),
	};
}

function readClaudeOAuthUsageWindow(value: unknown): ClaudeUsageWindow | null {
	const record = asRecord(value);
	if (!record) return null;
	const usedPercent = readPercent(record.utilization);
	const resetSeconds = readIsoResetSeconds(record.resets_at);
	if (usedPercent === null && resetSeconds === null) return null;
	return { usedPercent, resetSeconds };
}

function readClaudeUsageWindow(value: unknown): ClaudeUsageWindow | null {
	const record = asRecord(value);
	if (!record) return null;
	const usedPercent = readPercent(record.usedPercent);
	const resetSeconds = readIsoResetSeconds(record.resetsAt);
	if (usedPercent === null && resetSeconds === null) return null;
	return { usedPercent, resetSeconds };
}

function readIsoResetSeconds(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return null;
	return Math.max(0, timestamp / 1000 - Date.now() / 1000);
}

function readTimestampMs(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}

function serializeClaudeUsageWindow(window: ClaudeUsageWindow | null): { usedPercent: number | null; resetsAt: string | null } | null {
	if (!window) return null;
	return {
		usedPercent: window.usedPercent,
		resetsAt: window.resetSeconds === null ? null : new Date(Date.now() + window.resetSeconds * 1000).toISOString(),
	};
}

function isWindowLimited(window: ClaudeUsageWindow | null): boolean {
	return window?.usedPercent !== null && window?.usedPercent !== undefined && window.usedPercent >= 100;
}

function readPercent(value: unknown): number | null {
	const number = readNumber(value);
	return number === null ? null : clampPercent(number);
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function loadClaudeCodeAccessTokens(): Promise<string[]> {
	const services = await findClaudeCodeCredentialServices();
	const accessTokens: string[] = [];
	for (const service of services) {
		const parsed = asClaudeOAuthTokens(parseJson(await execSecurity(["find-generic-password", "-s", service, "-w"])));
		const oauth = asRecord(parsed?.claudeAiOauth);
		const accessToken = typeof oauth?.accessToken === "string" ? oauth.accessToken.trim() : "";
		if (accessToken) accessTokens.push(accessToken);
	}
	return accessTokens;
}

async function findClaudeCodeCredentialServices(): Promise<string[]> {
	const services = new Set<string>(["Claude Code-credentials"]);
	const dump = await execSecurity(["dump-keychain"]);
	for (const match of dump.matchAll(/"svce"<blob>="(Claude Code-credentials(?:-[^"]+)?)"/g)) {
		const service = match[1];
		if (service) services.add(service);
	}
	return [...services];
}

function execSecurity(args: string[]): Promise<string> {
	return new Promise((resolve) => {
		execFile("security", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
			resolve(error ? "" : stdout.trim());
		});
	});
}

async function readJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await fs.readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function asUsageLimitsFile(value: unknown): UsageLimitsFile | null {
	const record = asRecord(value);
	if (!record) return null;
	return { claudeOAuth: record.claudeOAuth };
}

function asCachedClaudeUsage(value: unknown): CachedClaudeUsage | null {
	const record = asRecord(value);
	if (!record) return null;
	return {
		fetchedAt: record.fetchedAt,
		fiveHour: record.fiveHour,
		sevenDay: record.sevenDay,
	};
}

function asClaudeOAuthUsageResponse(value: unknown): ClaudeOAuthUsageResponse | null {
	const record = asRecord(value);
	if (!record) return null;
	return {
		five_hour: record.five_hour,
		seven_day: record.seven_day,
	};
}

function asClaudeOAuthTokens(value: unknown): ClaudeOAuthTokens | null {
	const record = asRecord(value);
	if (!record) return null;
	return { claudeAiOauth: record.claudeAiOauth };
}

function asCodexUsageResponse(value: unknown): CodexUsageResponse | null {
	const record = asRecord(value);
	if (!record) return null;
	return {
		rate_limit: asRateLimitBucket(record.rate_limit),
		additional_rate_limits: asAdditionalRateLimits(record.additional_rate_limits),
	};
}

function asAdditionalRateLimits(value: unknown): Record<string, unknown> | unknown[] | null {
	if (Array.isArray(value)) return value;
	return asRecord(value);
}

function asRateLimitBucket(value: unknown): RateLimitBucket | null {
	const record = asRecord(value);
	if (!record) return null;
	return {
		allowed: typeof record.allowed === "boolean" ? record.allowed : undefined,
		limit_reached: typeof record.limit_reached === "boolean" ? record.limit_reached : undefined,
		primary_window: asUsageWindow(record.primary_window),
	};
}

function asUsageWindow(value: unknown): UsageWindow | null {
	const record = asRecord(value);
	if (!record) return null;
	return {
		used_percent: readNumber(record.used_percent),
		reset_after_seconds: readNumber(record.reset_after_seconds),
		reset_at: readNumber(record.reset_at),
	};
}

function asAuthEntry(value: unknown): AuthEntry | null {
	const record = asRecord(value);
	if (!record) return null;
	return {
		type: record.type,
		access: record.access,
		accountId: record.accountId,
		account_id: record.account_id,
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
