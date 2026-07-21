import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const APPLESCRIPT_TIMEOUT_MS = 5_000;
const run = promisify(execFile);

const sessionIsActiveScript = `tell application "Amphetamine"
	set sessionActive to session is active
end tell
sessionActive`;

const startSessionScript = `tell application "Amphetamine" to start new session`;

const stopSessionScript = `tell application "Amphetamine"
	if session is active then
		end session
	end if
end tell`;

export default function (pi: ExtensionAPI) {
	let startedByPi = false;
	let queue = Promise.resolve();
	let unavailable = false;

	const enqueue = (operation: () => Promise<void>) => {
		queue = queue.then(operation, operation);
		return queue;
	};

	const start = async (ctx: ExtensionContext) => {
		if (process.platform !== "darwin" || unavailable || startedByPi) return;

		try {
			await run("open", ["-Ra", "Amphetamine"], {
				timeout: APPLESCRIPT_TIMEOUT_MS,
			});

			const { stdout } = await run("osascript", ["-e", sessionIsActiveScript], {
				timeout: APPLESCRIPT_TIMEOUT_MS,
			});
			if (stdout.trim() === "true") return;

			await run("osascript", ["-e", startSessionScript], {
				timeout: APPLESCRIPT_TIMEOUT_MS,
			});
			startedByPi = true;
		} catch (error) {
			unavailable = true;
			ctx.ui.notify(`Amphetamine unavailable: ${amphetamineErrorMessage(error)}`, "warning");
		}
	};

	const stop = async (ctx: ExtensionContext) => {
		if (!startedByPi) return;

		try {
			await run("osascript", ["-e", stopSessionScript], {
				timeout: APPLESCRIPT_TIMEOUT_MS,
			});
		} catch (error) {
			ctx.ui.notify(`Amphetamine could not end its session: ${formatError(error)}`, "warning");
		} finally {
			startedByPi = false;
		}
	};

	pi.on("agent_start", (_event, ctx) => {
		void enqueue(() => start(ctx));
	});

	pi.on("agent_settled", (_event, ctx) => {
		void enqueue(() => stop(ctx));
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await enqueue(() => stop(ctx));
	});
}

function amphetamineErrorMessage(error: unknown): string {
	const message = formatError(error);
	return message.includes("Unable to find application")
		? "install Amphetamine, then reload Pi"
		: message;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
