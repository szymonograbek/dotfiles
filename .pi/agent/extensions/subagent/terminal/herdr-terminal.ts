import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { ProcessCommand, TerminalHost, TerminalSurfaceId } from "./terminal-host.ts";

type HerdrSurface = { tabId: string; paneId: string };

type HerdrTerminalOptions = {
	readonly workspaceId?: string;
};

const HerdrPane = Type.Object({ pane_id: Type.String() });
const HerdrCreateResponse = Type.Object({
	result: Type.Object({
		tab: Type.Object({ tab_id: Type.String() }),
		root_pane: Type.Optional(HerdrPane),
		pane: Type.Optional(HerdrPane),
	}),
});
const HerdrErrorResponse = Type.Object({
	error: Type.Object({ code: Type.String(), message: Type.String() }),
});

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function parseSurface(output: string): HerdrSurface {
	const envelope = parseJson(output);
	if (!Check(HerdrCreateResponse, envelope)) throw new Error("Herdr tab create returned an invalid response.");
	const pane = envelope.result.root_pane ?? envelope.result.pane;
	if (pane === undefined) throw new Error("Herdr tab create returned no pane id.");
	return { tabId: envelope.result.tab.tab_id, paneId: pane.pane_id };
}

function isMissingTab(stdout: string, stderr: string): boolean {
	const response = parseJson(stderr || stdout);
	return Check(HerdrErrorResponse, response) && response.error.code === "tab_not_found";
}

function commandText(command: ProcessCommand): string {
	const environment = Object.entries(command.env ?? {}).map(([name, value]) => `${name}=${shellQuote(value)}`);
	const invocation = [command.executable, ...command.args].map(shellQuoteToken).join(" ");
	return environment.length === 0 ? invocation : `env ${environment.join(" ")} ${invocation}`;
}

function shellQuoteToken(value: string): string {
	return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : shellQuote(value);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandError(stdout: string, stderr: string, fallback: string): Error {
	return new Error(stderr || stdout || fallback);
}

export class HerdrTerminal implements TerminalHost {
	private readonly surfaces = new Map<TerminalSurfaceId, HerdrSurface>();

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly options: HerdrTerminalOptions = {},
	) {}

	async createSurface(
		request: { cwd: string; label: string; focus: boolean },
		signal?: AbortSignal,
	): Promise<TerminalSurfaceId> {
		const args = ["tab", "create"];
		if (this.options.workspaceId !== undefined) args.push("--workspace", this.options.workspaceId);
		args.push("--cwd", request.cwd, "--label", request.label);
		if (!request.focus) args.push("--no-focus");
		const result = await this.pi.exec("herdr", args, { timeout: 5000, signal });
		if (result.code !== 0) throw commandError(result.stdout, result.stderr, "Failed to create terminal surface.");
		const id = randomUUID();
		this.surfaces.set(id, parseSurface(result.stdout));
		return id;
	}

	async start(surfaceId: TerminalSurfaceId, command: ProcessCommand, signal?: AbortSignal): Promise<void> {
		const surface = this.surface(surfaceId);
		const result = await this.pi.exec("herdr", ["pane", "run", surface.paneId, commandText(command)], { timeout: 5000, signal });
		if (result.code !== 0) throw commandError(result.stdout, result.stderr, "Failed to start process in terminal surface.");
	}

	async focus(surfaceId: TerminalSurfaceId, signal?: AbortSignal): Promise<void> {
		const result = await this.pi.exec("herdr", ["tab", "focus", this.surface(surfaceId).tabId], { timeout: 5000, signal });
		if (result.code !== 0) throw commandError(result.stdout, result.stderr, "Failed to focus terminal surface.");
	}

	async close(surfaceId: TerminalSurfaceId | undefined): Promise<void> {
		if (surfaceId === undefined) return;
		const surface = this.surfaces.get(surfaceId);
		if (surface === undefined) return;
		const result = await this.pi.exec("herdr", ["tab", "close", surface.tabId], { timeout: 5000 });
		if (result.code !== 0 && !isMissingTab(result.stdout, result.stderr)) {
			throw commandError(result.stdout, result.stderr, "Failed to close terminal surface.");
		}
		this.surfaces.delete(surfaceId);
	}

	async closeAll(): Promise<void> {
		const results = await Promise.allSettled([...this.surfaces.keys()].map((surfaceId) => this.close(surfaceId)));
		const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
		if (failures.length > 0) throw new AggregateError(failures, "Failed to close all terminal surfaces.");
	}

	async isOpen(surfaceId: TerminalSurfaceId, signal?: AbortSignal): Promise<boolean> {
		const surface = this.surfaces.get(surfaceId);
		if (surface === undefined) return false;
		const result = await this.pi.exec("herdr", ["tab", "get", surface.tabId], { timeout: 3000, signal });
		if (result.code === 0) return true;
		if (isMissingTab(result.stdout, result.stderr)) {
			this.surfaces.delete(surfaceId);
			return false;
		}
		throw commandError(result.stdout, result.stderr, "Failed to inspect terminal surface.");
	}

	private surface(id: TerminalSurfaceId): HerdrSurface {
		const surface = this.surfaces.get(id);
		if (surface === undefined) throw new Error("Terminal surface is no longer available.");
		return surface;
	}
}
