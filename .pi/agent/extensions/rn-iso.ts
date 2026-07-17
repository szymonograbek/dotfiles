import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PLATFORMS: ["ios", "android"] = ["ios", "android"];

interface DeviceAssignment {
	platform: "ios" | "android";
	deviceId: string;
	metroPort: number;
	metroHealthy: boolean;
	metroPid?: number;
	metroLog?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packageNames(value: unknown): string[] {
	if (!isRecord(value)) return [];
	return Object.keys(value);
}

async function isReactNativeProject(cwd: string): Promise<boolean> {
	try {
		const text = await readFile(join(cwd, "package.json"), "utf8");
		const manifest: unknown = JSON.parse(text);
		if (!isRecord(manifest)) return false;

		const dependencies = [
			...packageNames(manifest.dependencies),
			...packageNames(manifest.devDependencies),
		];
		return dependencies.includes("react-native") || dependencies.includes("expo");
	} catch {
		return false;
	}
}

function parseAssignment(text: string, expectedPlatform: "ios" | "android"): DeviceAssignment {
	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error("rn-iso returned invalid device JSON");
	}

	if (!isRecord(payload) || payload.platform !== expectedPlatform) {
		throw new Error(`rn-iso did not return a ${expectedPlatform} assignment`);
	}

	const deviceId = expectedPlatform === "ios" ? payload.udid : payload.serial;
	if (typeof deviceId !== "string" || deviceId.length === 0) {
		throw new Error(`rn-iso returned no ${expectedPlatform === "ios" ? "UDID" : "serial"}`);
	}

	if (typeof payload.metroPort !== "number" || !Number.isInteger(payload.metroPort)) {
		throw new Error("rn-iso returned an invalid Metro port");
	}

	if (typeof payload.metroHealthy !== "boolean") {
		throw new Error("rn-iso returned no Metro health status");
	}

	const assignment: DeviceAssignment = {
		platform: expectedPlatform,
		deviceId,
		metroPort: payload.metroPort,
		metroHealthy: payload.metroHealthy,
	};

	if (typeof payload.metroPid === "number" && Number.isInteger(payload.metroPid)) {
		assignment.metroPid = payload.metroPid;
	}
	if (typeof payload.metroLog === "string" && payload.metroLog.length > 0) {
		assignment.metroLog = payload.metroLog;
	}

	return assignment;
}

function commandFailure(command: string, stdout: string, stderr: string): Error {
	const output = `${stdout}\n${stderr}`.trim();
	const tail = output.length > 4000 ? output.slice(-4000) : output;
	return new Error(tail.length > 0 ? `${command} failed:\n${tail}` : `${command} failed`);
}

export default function rnIsoExtension(pi: ExtensionAPI): void {
	let registered = false;

	pi.on("session_start", async (_event, ctx) => {
		if (registered || !(await isReactNativeProject(ctx.cwd))) return;
		registered = true;

		pi.registerTool({
			name: "rn_iso_prepare_device",
			label: "Prepare RN Device",
			description:
				"Get this React Native workspace’s rn-iso device and managed Metro details. If they do not exist, prepare them first. Reuses an existing healthy assignment without allocating another device or rebuilding; set rebuildNative after native-code or native-module changes.",
			promptSnippet:
				"Get or prepare this workspace’s rn-iso device and managed Metro details; reuses an existing healthy assignment",
			promptGuidelines: [
				"Use rn_iso_prepare_device to get the workspace’s assigned device before React Native UI verification with Argent. The call is idempotent: when a healthy assignment exists, it returns that device and Metro information without rebuilding.",
			],
			parameters: Type.Object({
				platform: StringEnum(PLATFORMS, {
					description: "Platform required by the verification plan",
				}),
				rebuildNative: Type.Optional(
					Type.Boolean({
						description: "Rebuild and reinstall after native-code or native-module changes",
						default: false,
					}),
				),
			}),
			async execute(_toolCallId, params, signal, onUpdate, toolCtx) {
				const deviceArgs = ["rn-iso", "device", "--platform", params.platform, "--json"];
				const readDevice = () => pi.exec("npx", deviceArgs, { cwd: toolCtx.cwd, signal });

				let deviceResult = await readDevice();
				let assignment =
					deviceResult.code === 0 ? parseAssignment(deviceResult.stdout, params.platform) : undefined;

				if (params.rebuildNative === true || assignment === undefined) {
					onUpdate?.({
						content: [{ type: "text", text: `Preparing ${params.platform} with managed Metro…` }],
					});

					const prepareArgs = ["rn-iso", params.platform, "--auto", "--managed-metro"];
					const prepareResult = await pi.exec("npx", prepareArgs, {
						cwd: toolCtx.cwd,
						signal,
					});
					if (prepareResult.code !== 0) {
						throw commandFailure(`npx ${prepareArgs.join(" ")}`, prepareResult.stdout, prepareResult.stderr);
					}
				} else if (!assignment.metroHealthy) {
					onUpdate?.({
						content: [{ type: "text", text: "Restarting managed Metro…" }],
					});

					const startArgs = ["rn-iso", "start"];
					const startResult = await pi.exec("npx", startArgs, { cwd: toolCtx.cwd, signal });
					if (startResult.code !== 0) {
						throw commandFailure(`npx ${startArgs.join(" ")}`, startResult.stdout, startResult.stderr);
					}
				}

				deviceResult = await readDevice();
				if (deviceResult.code !== 0) {
					throw commandFailure(`npx ${deviceArgs.join(" ")}`, deviceResult.stdout, deviceResult.stderr);
				}

				assignment = parseAssignment(deviceResult.stdout, params.platform);
				if (!assignment.metroHealthy) {
					throw new Error(
						`Metro is not healthy on port ${assignment.metroPort}. Check ${assignment.metroLog ?? "npx rn-iso logs"}.`,
					);
				}

				const logLine = assignment.metroLog ? `\nMetro log: ${assignment.metroLog}` : "";
				return {
					content: [
						{
							type: "text",
							text: `rn-iso is ready on ${assignment.platform}. Use deviceId ${assignment.deviceId} as udid for every Argent device call. Do not select another booted device.\nMetro: healthy on port ${assignment.metroPort}${logLine}`,
						},
					],
					details: assignment,
				};
			},
		});
	});
}
