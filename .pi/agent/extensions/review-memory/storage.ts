import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReviewFeedback, SessionCursor } from "./session-history";

export type InstructionRevision = {
	readonly id: string;
	readonly firstSeenAt: string;
	readonly targetPath: string;
	readonly content: string;
	readonly contentHash: string;
};

export type InstructionObservation = {
	readonly capturedAt: string;
	readonly sessionFile: string | undefined;
	readonly sessionId: string;
	readonly revisionId: string;
	readonly systemPromptHash: string;
};

export type ReviewMemoryState = {
	readonly version: 1;
	readonly projectRoot: string;
	readonly projectIdentity: string;
	readonly feedback: readonly ReviewFeedback[];
	readonly sessionCursors: Readonly<Record<string, SessionCursor>>;
	readonly instructionRevisions: readonly InstructionRevision[];
	readonly instructionObservations: readonly InstructionObservation[];
	readonly lastScanAt: string | undefined;
};

export type StateLocation = {
	readonly directory: string;
	readonly statePath: string;
};

export function getStateLocation(agentDirectory: string, projectIdentity: string): StateLocation {
	const key = digest(projectIdentity).slice(0, 16);
	const directory = path.join(agentDirectory, "review-memory", key);
	return {
		directory,
		statePath: path.join(directory, "state.json"),
	};
}

export async function readState(location: StateLocation, projectRoot: string, projectIdentity: string): Promise<ReviewMemoryState> {
	if (!existsSync(location.statePath)) return emptyState(projectRoot, projectIdentity);

	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(location.statePath, "utf8"));
	} catch (error: unknown) {
		throw new Error(`Cannot parse review-memory state at ${location.statePath}: ${errorMessage(error)}`);
	}

	const state = parseState(parsed);
	if (state === undefined) throw new Error(`Unsupported or invalid review-memory state at ${location.statePath}`);
	if (state.projectIdentity !== projectIdentity) throw new Error(`Review-memory identity mismatch at ${location.statePath}`);
	return state;
}

export async function writeState(location: StateLocation, state: ReviewMemoryState): Promise<void> {
	await withStateLock(location, async () => {
		const persisted = await readState(location, state.projectRoot, state.projectIdentity);
		await writeJsonAtomically(location.statePath, mergeStates(persisted, state));
	});
}

export function mergeFeedback(existing: readonly ReviewFeedback[], incoming: readonly ReviewFeedback[]): readonly ReviewFeedback[] {
	const byId = new Map(existing.map((feedback) => [feedback.id, feedback]));
	for (const feedback of incoming) byId.set(feedback.id, feedback);
	return [...byId.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function recordInstructionSnapshot(
	state: ReviewMemoryState,
	snapshot: {
		readonly capturedAt: string;
		readonly sessionFile: string | undefined;
		readonly sessionId: string;
		readonly targetPath: string;
		readonly content: string;
		readonly systemPrompt: string;
	},
): ReviewMemoryState {
	const contentHash = digest(snapshot.content);
	const revisionId = digest(`${snapshot.targetPath}\n${contentHash}`);
	const revisionExists = state.instructionRevisions.some((revision) => revision.id === revisionId);
	const observationExists = state.instructionObservations.some(
		(observation) => observation.sessionId === snapshot.sessionId && observation.revisionId === revisionId,
	);

	const revision: InstructionRevision = {
		id: revisionId,
		firstSeenAt: snapshot.capturedAt,
		targetPath: snapshot.targetPath,
		content: snapshot.content,
		contentHash,
	};
	const observation: InstructionObservation = {
		capturedAt: snapshot.capturedAt,
		sessionFile: snapshot.sessionFile,
		sessionId: snapshot.sessionId,
		revisionId,
		systemPromptHash: digest(snapshot.systemPrompt),
	};

	return {
		...state,
		instructionRevisions: revisionExists ? state.instructionRevisions : [...state.instructionRevisions, revision],
		instructionObservations: observationExists ? state.instructionObservations : [...state.instructionObservations, observation],
	};
}

function emptyState(projectRoot: string, projectIdentity: string): ReviewMemoryState {
	return {
		version: 1,
		projectRoot,
		projectIdentity,
		feedback: [],
		sessionCursors: {},
		instructionRevisions: [],
		instructionObservations: [],
		lastScanAt: undefined,
	};
}

function parseState(value: unknown): ReviewMemoryState | undefined {
	if (!isRecord(value) || value.version !== 1) return undefined;
	if (typeof value.projectRoot !== "string" || typeof value.projectIdentity !== "string") return undefined;
	if (!Array.isArray(value.feedback) || !value.feedback.every(isReviewFeedback)) return undefined;
	if (!isRecord(value.sessionCursors) || !Object.values(value.sessionCursors).every(isSessionCursor)) return undefined;
	if (!Array.isArray(value.instructionRevisions) || !value.instructionRevisions.every(isInstructionRevision)) return undefined;
	if (!Array.isArray(value.instructionObservations) || !value.instructionObservations.every(isInstructionObservation)) return undefined;
	if (value.lastScanAt !== undefined && typeof value.lastScanAt !== "string") return undefined;

	const sessionCursors: Record<string, SessionCursor> = {};
	for (const [sessionPath, cursor] of Object.entries(value.sessionCursors)) {
		if (!isSessionCursor(cursor)) return undefined;
		sessionCursors[sessionPath] = cursor;
	}

	return {
		version: 1,
		projectRoot: value.projectRoot,
		projectIdentity: value.projectIdentity,
		feedback: value.feedback,
		sessionCursors,
		instructionRevisions: value.instructionRevisions,
		instructionObservations: value.instructionObservations,
		lastScanAt: value.lastScanAt,
	};
}

function mergeStates(persisted: ReviewMemoryState, incoming: ReviewMemoryState): ReviewMemoryState {
	return {
		...incoming,
		feedback: mergeFeedback(persisted.feedback, incoming.feedback),
		sessionCursors: { ...persisted.sessionCursors, ...incoming.sessionCursors },
		instructionRevisions: mergeById(persisted.instructionRevisions, incoming.instructionRevisions),
		instructionObservations: mergeObservations(persisted.instructionObservations, incoming.instructionObservations),
		lastScanAt: latestTimestamp(persisted.lastScanAt, incoming.lastScanAt),
	};
}

function mergeById<T extends { readonly id: string }>(persisted: readonly T[], incoming: readonly T[]): readonly T[] {
	const values = new Map(persisted.map((value) => [value.id, value]));
	for (const value of incoming) values.set(value.id, value);
	return [...values.values()];
}

function mergeObservations(
	persisted: readonly InstructionObservation[],
	incoming: readonly InstructionObservation[],
): readonly InstructionObservation[] {
	const key = (observation: InstructionObservation) => `${observation.sessionId}\n${observation.revisionId}`;
	const values = new Map(persisted.map((observation) => [key(observation), observation]));
	for (const observation of incoming) values.set(key(observation), observation);
	return [...values.values()];
}

function latestTimestamp(left: string | undefined, right: string | undefined): string | undefined {
	if (left === undefined) return right;
	if (right === undefined) return left;
	return left.localeCompare(right) >= 0 ? left : right;
}

async function withStateLock(location: StateLocation, operation: () => Promise<void>): Promise<void> {
	await mkdir(location.directory, { recursive: true });
	const lockPath = `${location.statePath}.lock`;
	const deadline = Date.now() + 5_000;

	while (true) {
		try {
			const lock = await open(lockPath, "wx");
			await lock.close();
			break;
		} catch (error: unknown) {
			if (!isFileExistsError(error)) throw error;
			if (await isStaleLock(lockPath)) {
				await unlink(lockPath).catch(() => undefined);
				continue;
			}
			if (Date.now() >= deadline) throw new Error(`Timed out waiting for review-memory lock ${lockPath}`);
			await delay(50);
		}
	}

	try {
		await operation();
	} finally {
		await unlink(lockPath).catch(() => undefined);
	}
}

async function isStaleLock(lockPath: string): Promise<boolean> {
	try {
		return Date.now() - (await stat(lockPath)).mtimeMs > 30_000;
	} catch {
		return false;
	}
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
	await writeTextAtomically(filePath, `${JSON.stringify(value, null, "\t")}\n`);
}

async function writeTextAtomically(filePath: string, content: string): Promise<void> {
	const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, content, "utf8");
	await rename(temporaryPath, filePath);
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isFileExistsError(error: unknown): boolean {
	return isRecord(error) && error.code === "EEXIST";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isReviewFeedback(value: unknown): value is ReviewFeedback {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.sessionFile === "string" &&
		typeof value.sessionCwd === "string" &&
		typeof value.entryId === "string" &&
		typeof value.timestamp === "string" &&
		(value.source === "human" || value.source === "automated") &&
		typeof value.text === "string" &&
		Array.isArray(value.comments) &&
		value.comments.every(isReviewComment)
	);
}

function isReviewComment(value: unknown): boolean {
	return (
		isRecord(value) &&
		(value.file === undefined || typeof value.file === "string") &&
		(value.area === undefined || typeof value.area === "string") &&
		typeof value.text === "string"
	);
}

function isSessionCursor(value: unknown): value is SessionCursor {
	return isRecord(value) && typeof value.size === "number" && typeof value.modifiedAtMs === "number";
}

function isInstructionRevision(value: unknown): value is InstructionRevision {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.firstSeenAt === "string" &&
		typeof value.targetPath === "string" &&
		typeof value.content === "string" &&
		typeof value.contentHash === "string"
	);
}

function isInstructionObservation(value: unknown): value is InstructionObservation {
	return (
		isRecord(value) &&
		typeof value.capturedAt === "string" &&
		(value.sessionFile === undefined || typeof value.sessionFile === "string") &&
		typeof value.sessionId === "string" &&
		typeof value.revisionId === "string" &&
		typeof value.systemPromptHash === "string"
	);
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
