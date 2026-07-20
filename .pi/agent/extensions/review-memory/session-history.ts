import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type ReviewSource = "human" | "automated";

export type ReviewComment = {
	readonly file: string | undefined;
	readonly area: string | undefined;
	readonly text: string;
};

export type ReviewFeedback = {
	readonly id: string;
	readonly sessionFile: string;
	readonly sessionCwd: string;
	readonly entryId: string;
	readonly timestamp: string;
	readonly source: ReviewSource;
	readonly text: string;
	readonly comments: readonly ReviewComment[];
};

export type SessionCursor = {
	readonly size: number;
	readonly modifiedAtMs: number;
};

export type ScanResult = {
	readonly feedback: readonly ReviewFeedback[];
	readonly cursors: Readonly<Record<string, SessionCursor>>;
	readonly scannedFiles: number;
};

type SessionHeader = {
	readonly cwd: string;
};

type SessionProject = {
	readonly identity: string;
};

type ParsedMessage = {
	readonly entryId: string;
	readonly timestamp: string;
	readonly text: string;
};

const REVIEW_HEADING = /^#?\s*Code Review Feedback\s*$/m;
const AUTOMATED_SUFFIX = "The findings above came from an automated review of the current changes.";
const HUMAN_SUFFIX = "The feedback above came from the user's code review of the current changes.";
const LEGACY_SUFFIX = "Please address this feedback.";
export const PROJECT_ENTRY_TYPE = "review-memory-project";
export const PROJECT_ENTRY_VERSION = 1;

export function scanReviewSessions(
	sessionsRoot: string,
	projectRoot: string,
	projectIdentity: string,
	previousCursors: Readonly<Record<string, SessionCursor>>,
): ScanResult {
	const sessionFiles = findJsonlFiles(sessionsRoot);
	const cursors: Record<string, SessionCursor> = { ...previousCursors };
	const feedback: ReviewFeedback[] = [];
	let scannedFiles = 0;

	for (const sessionFile of sessionFiles) {
		const fileStat = statSync(sessionFile);
		const cursor = previousCursors[sessionFile];
		if (cursor?.size === fileStat.size && cursor.modifiedAtMs === fileStat.mtimeMs) continue;

		const parsed = parseSession(sessionFile);
		cursors[sessionFile] = { size: fileStat.size, modifiedAtMs: fileStat.mtimeMs };
		if (parsed === undefined) continue;
		if (!belongsToProject(parsed.header.cwd, parsed.project?.identity, projectRoot, projectIdentity)) continue;

		scannedFiles += 1;
		for (const message of parsed.messages) {
			const normalized = normalizeReviewFeedback(message.text);
			if (normalized === undefined) continue;

			feedback.push({
				id: digest(`${sessionFile}\n${message.entryId}`),
				sessionFile,
				sessionCwd: parsed.header.cwd,
				entryId: message.entryId,
				timestamp: message.timestamp,
				source: normalized.source,
				text: normalized.text,
				comments: parseComments(normalized.text),
			});
		}
	}

	return { feedback, cursors, scannedFiles };
}

export function findProjectRoot(startDirectory: string): string {
	let current = path.resolve(startDirectory);

	while (true) {
		if (existsSync(path.join(current, ".jj")) || existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return path.resolve(startDirectory);
		current = parent;
	}
}

export function getProjectIdentity(projectRoot: string): string {
	const remote = readOriginRemote(projectRoot) ?? readJjOriginRemote(projectRoot);
	if (remote !== undefined) return `remote:${normalizeRemote(remote)}`;

	const jjRepository = resolveJjRepository(projectRoot);
	return jjRepository === undefined ? `path:${path.resolve(projectRoot)}` : `jj:${jjRepository}`;
}

function findJsonlFiles(root: string): readonly string[] {
	if (!existsSync(root)) return [];

	const files: string[] = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		if (directory === undefined) break;

		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) pending.push(entryPath);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(entryPath);
		}
	}

	return files;
}

function parseSession(sessionFile: string):
	| { readonly header: SessionHeader; readonly project: SessionProject | undefined; readonly messages: readonly ParsedMessage[] }
	| undefined {
	let header: SessionHeader | undefined;
	let project: SessionProject | undefined;
	const messages: ParsedMessage[] = [];

	for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
		if (line.trim() === "") continue;

		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			continue;
		}

		if (!isRecord(value)) continue;
		if (value.type === "session" && typeof value.cwd === "string") {
			header = { cwd: value.cwd };
			continue;
		}
		if (
			value.type === "custom" &&
			value.customType === PROJECT_ENTRY_TYPE &&
			isRecord(value.data) &&
			value.data.version === PROJECT_ENTRY_VERSION &&
			typeof value.data.identity === "string"
		) {
			project = { identity: value.data.identity };
			continue;
		}
		if (value.type !== "message" || !isRecord(value.message) || value.message.role !== "user") continue;

		const text = extractText(value.message.content);
		if (text === undefined || !REVIEW_HEADING.test(text)) continue;
		if (typeof value.id !== "string" || typeof value.timestamp !== "string") continue;
		messages.push({ entryId: value.id, timestamp: value.timestamp, text });
	}

	return header === undefined ? undefined : { header, project, messages };
}

function normalizeReviewFeedback(text: string): { readonly source: ReviewSource; readonly text: string } | undefined {
	const trimmed = text.trim();
	const headingMatch = REVIEW_HEADING.exec(trimmed);
	if (headingMatch === null || headingMatch.index !== 0) return undefined;

	const automatedSuffixStart = trimmed.lastIndexOf(AUTOMATED_SUFFIX);
	const source: ReviewSource = automatedSuffixStart >= 0 ? "automated" : "human";
	const suffixStarts = [AUTOMATED_SUFFIX, HUMAN_SUFFIX, LEGACY_SUFFIX]
		.map((marker) => trimmed.indexOf(marker))
		.filter((index) => index >= 0);
	const contentEnd = suffixStarts.length === 0 ? trimmed.length : Math.min(...suffixStarts);
	const feedbackText = trimmed.slice(0, contentEnd).trim();
	return feedbackText === "" ? undefined : { source, text: feedbackText };
}

function parseComments(feedback: string): readonly ReviewComment[] {
	const lines = feedback.split("\n");
	const comments: ReviewComment[] = [];
	let currentFile: string | undefined;
	let currentArea: string | undefined;
	let commentLines: string[] = [];

	const flush = () => {
		const text = commentLines.join("\n").trim();
		if (text !== "") comments.push({ file: currentFile, area: currentArea, text });
		commentLines = [];
	};

	for (const line of lines.slice(1)) {
		const trimmedLine = line.trim();
		if (trimmedLine.startsWith("## ")) {
			flush();
			currentFile = trimmedLine.slice(3).trim() || undefined;
			currentArea = undefined;
			continue;
		}
		if (isLegacyFileHeading(trimmedLine)) {
			flush();
			currentFile = trimmedLine;
			currentArea = undefined;
			continue;
		}
		if (trimmedLine.startsWith("### ")) {
			flush();
			currentArea = trimmedLine.slice(4).trim() || undefined;
			continue;
		}
		if (currentArea !== undefined) commentLines.push(line);
	}
	flush();

	return comments;
}

function isLegacyFileHeading(line: string): boolean {
	return !line.includes(" ") && line.includes("/") && /\.[a-zA-Z0-9]+$/.test(line);
}

function belongsToProject(
	sessionCwd: string,
	sessionProjectIdentity: string | undefined,
	projectRoot: string,
	projectIdentity: string,
): boolean {
	if (sessionProjectIdentity !== undefined) return sessionProjectIdentity === projectIdentity;

	const sessionRoot = findProjectRoot(sessionCwd);
	if (path.resolve(sessionRoot) === path.resolve(projectRoot)) return true;
	if (!existsSync(sessionCwd)) return false;
	return getProjectIdentity(sessionRoot) === projectIdentity;
}

function readOriginRemote(projectRoot: string): string | undefined {
	const gitConfigPath = resolveGitConfigPath(projectRoot);
	return gitConfigPath === undefined ? undefined : readOriginFromConfig(gitConfigPath);
}

function readJjOriginRemote(projectRoot: string): string | undefined {
	const repository = resolveJjRepository(projectRoot);
	if (repository === undefined) return undefined;

	const gitTargetPath = path.join(repository, "store", "git_target");
	if (!existsSync(gitTargetPath)) return undefined;
	const gitTarget = readFileSync(gitTargetPath, "utf8").trim();
	if (gitTarget === "") return undefined;

	return readOriginFromConfig(path.join(path.resolve(path.dirname(gitTargetPath), gitTarget), "config"));
}

function readOriginFromConfig(configPath: string): string | undefined {
	if (!existsSync(configPath)) return undefined;
	const config = readFileSync(configPath, "utf8");
	const originStart = config.search(/^\[remote "origin"\]\s*$/m);
	if (originStart < 0) return undefined;

	const afterOriginHeader = config.slice(originStart).replace(/^\[remote "origin"\]\s*\n?/, "");
	const nextSectionStart = afterOriginHeader.search(/^\[/m);
	const originSection = nextSectionStart < 0 ? afterOriginHeader : afterOriginHeader.slice(0, nextSectionStart);
	return /^\s*url\s*=\s*(.+?)\s*$/m.exec(originSection)?.[1];
}

function resolveJjRepository(projectRoot: string): string | undefined {
	const repositoryPath = path.join(projectRoot, ".jj", "repo");
	if (!existsSync(repositoryPath)) return undefined;

	const repositoryStat = statSync(repositoryPath);
	if (repositoryStat.isDirectory()) return realpathSync(repositoryPath);
	if (!repositoryStat.isFile()) return undefined;

	const repositoryTarget = readFileSync(repositoryPath, "utf8").trim();
	if (repositoryTarget === "") return undefined;
	const resolvedRepository = path.resolve(path.dirname(repositoryPath), repositoryTarget);
	return existsSync(resolvedRepository) ? realpathSync(resolvedRepository) : undefined;
}

function resolveGitConfigPath(projectRoot: string): string | undefined {
	const dotGitPath = path.join(projectRoot, ".git");
	if (!existsSync(dotGitPath)) return undefined;

	const dotGitStat = statSync(dotGitPath);
	if (dotGitStat.isDirectory()) return path.join(dotGitPath, "config");
	if (!dotGitStat.isFile()) return undefined;

	const gitDirectoryMatch = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGitPath, "utf8"));
	const gitDirectoryValue = gitDirectoryMatch?.[1];
	if (gitDirectoryValue === undefined) return undefined;
	const gitDirectory = path.resolve(projectRoot, gitDirectoryValue);
	const commonDirectoryPath = path.join(gitDirectory, "commondir");
	if (!existsSync(commonDirectoryPath)) return path.join(gitDirectory, "config");

	const commonDirectory = readFileSync(commonDirectoryPath, "utf8").trim();
	return path.join(path.resolve(gitDirectory, commonDirectory), "config");
}

function normalizeRemote(remote: string): string {
	return remote.trim().replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "").toLowerCase();
}

function extractText(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;

	const textParts: string[] = [];
	for (const part of content) {
		if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") continue;
		textParts.push(part.text);
	}
	return textParts.length === 0 ? undefined : textParts.join("\n");
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
