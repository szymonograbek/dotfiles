import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { Type } from "typebox";

const LocationParams = Type.Object({
	filePath: Type.String({ description: "TypeScript/JavaScript file containing the symbol. Relative paths are resolved from the current working directory." }),
	line: Type.Integer({ description: "1-based line number of the symbol." }),
	column: Type.Integer({ description: "1-based column number of the symbol." }),
});

const RenameParams = Type.Object({
	filePath: Type.String({ description: "TypeScript/JavaScript file containing the symbol to rename. Relative paths are resolved from the current working directory." }),
	line: Type.Integer({ description: "1-based line number of the symbol." }),
	column: Type.Integer({ description: "1-based column number of the symbol." }),
	newName: Type.String({ description: "New symbol name." }),
	dryRun: Type.Optional(Type.Boolean({ description: "If true, only preview edits. Defaults to false." })),
});

type LocationParams = {
	readonly filePath: string;
	readonly line: number;
	readonly column: number;
};

type RenameParams = LocationParams & {
	readonly newName: string;
	readonly dryRun?: boolean;
};

type FileEdit = {
	readonly fileName: string;
	readonly replacements: readonly Replacement[];
};

type Replacement = {
	readonly start: number;
	readonly length: number;
	readonly text: string;
};

type LoadedFile = {
	readonly text: string;
	readonly version: string;
};

type ServiceAtLocation = {
	readonly service: ts.LanguageService;
	readonly fileName: string;
	readonly position: number;
};

type SpanLocation = {
	readonly filePath: string;
	readonly line: number;
	readonly column: number;
	readonly endLine: number;
	readonly endColumn: number;
	readonly text?: string;
};

function result(text: string, details: unknown): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? "null";
}

function findTsConfig(startFile: string, cwd: string): string | undefined {
	const startDir = fs.existsSync(startFile) && fs.statSync(startFile).isDirectory() ? startFile : path.dirname(startFile);
	return ts.findConfigFile(startDir, ts.sys.fileExists, "tsconfig.json") ?? ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
}

function parseProject(fileName: string, cwd: string): ts.ParsedCommandLine {
	const configPath = findTsConfig(fileName, cwd);
	if (configPath === undefined) {
		const options: ts.CompilerOptions = {
			allowJs: true,
			checkJs: false,
			jsx: ts.JsxEmit.ReactJSX,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			target: ts.ScriptTarget.ES2022,
		};
		return {
			options,
			fileNames: [fileName],
			errors: [],
			wildcardDirectories: {},
			compileOnSave: false,
			raw: {},
			typeAcquisition: { enable: false, include: [], exclude: [] },
		};
	}

	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));

	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
	if (parsed.errors.length > 0) {
		throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
	}
	return parsed;
}

function realPathForExisting(fileName: string): string {
	return fs.realpathSync(fileName);
}

function ensureInsideCwd(fileName: string, cwd: string): string {
	const realCwd = realPathForExisting(cwd);
	const realFile = realPathForExisting(fileName);
	const relative = path.relative(realCwd, realFile);
	if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return realFile;
	throw new Error(`Refusing to edit outside current working directory: ${fileName}`);
}

function ensureEditable(fileName: string, cwd: string): string {
	const realFile = ensureInsideCwd(fileName, cwd);
	const parts = path.relative(realPathForExisting(cwd), realFile).split(path.sep);
	if (parts.includes("node_modules") || parts.includes("dist") || parts.includes("build") || parts.includes("coverage")) {
		throw new Error(`Refusing to edit generated/dependency path: ${fileName}`);
	}
	return realFile;
}

function projectPath(fileName: string, cwd: string): string {
	const absolute = path.resolve(fileName);
	const relative = path.relative(cwd, absolute);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? relative : absolute;
}

function sourcePosition(fileName: string, line: number, column: number): number {
	if (!Number.isInteger(line) || line < 1) throw new Error("line must be a 1-based positive integer.");
	if (!Number.isInteger(column) || column < 1) throw new Error("column must be a 1-based positive integer.");
	const text = fs.readFileSync(fileName, "utf8");
	const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
	const lines = source.getLineStarts();
	const lineStart = lines[line - 1];
	if (lineStart === undefined) throw new Error(`Line ${line} is outside ${fileName}.`);
	const nextLineStart = lines[line] ?? text.length + 1;
	const position = lineStart + column - 1;
	if (position >= nextLineStart) throw new Error(`Column ${column} is outside line ${line}.`);
	return position;
}

function createLanguageService(parsed: ts.ParsedCommandLine, targetFile: string, cwd: string): ts.LanguageService {
	const files = new Map<string, LoadedFile>();
	const fileNames = parsed.fileNames.includes(targetFile) ? parsed.fileNames : [...parsed.fileNames, targetFile];

	function loadFile(fileName: string): LoadedFile | undefined {
		const normalized = path.normalize(fileName);
		const cached = files.get(normalized);
		if (cached !== undefined) return cached;
		if (!fs.existsSync(normalized)) return undefined;
		const loaded = { text: fs.readFileSync(normalized, "utf8"), version: "0" };
		files.set(normalized, loaded);
		return loaded;
	}

	const host: ts.LanguageServiceHost = {
		getCompilationSettings: () => parsed.options,
		getCurrentDirectory: () => cwd,
		getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		getScriptFileNames: () => fileNames,
		getScriptVersion: (fileName) => loadFile(fileName)?.version ?? "0",
		getScriptSnapshot: (fileName) => {
			const loaded = loadFile(fileName);
			return loaded === undefined ? undefined : ts.ScriptSnapshot.fromString(loaded.text);
		},
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
		getDirectories: ts.sys.getDirectories,
	};

	return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function collectEdits(locations: readonly ts.RenameLocation[], newName: string, cwd: string): FileEdit[] {
	const byFile = new Map<string, Replacement[]>();
	for (const location of locations) {
		const fileName = ensureEditable(location.fileName, cwd);
		const existing = byFile.get(fileName) ?? [];
		existing.push({
			start: location.textSpan.start,
			length: location.textSpan.length,
			text: `${location.prefixText ?? ""}${newName}${location.suffixText ?? ""}`,
		});
		byFile.set(fileName, existing);
	}
	return [...byFile.entries()].map(([fileName, replacements]) => ({ fileName, replacements }));
}

function applyFileEdit(edit: FileEdit): void {
	const sorted = [...edit.replacements].sort((left, right) => right.start - left.start);
	let text = fs.readFileSync(edit.fileName, "utf8");
	for (const replacement of sorted) {
		text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.start + replacement.length);
	}
	fs.writeFileSync(edit.fileName, text);
}

function lineAndColumn(fileName: string, start: number): { readonly line: number; readonly column: number } {
	const text = fs.readFileSync(fileName, "utf8");
	const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
	const position = source.getLineAndCharacterOfPosition(start);
	return { line: position.line + 1, column: position.character + 1 };
}

function sourceLine(fileName: string, line: number): string | undefined {
	if (!fs.existsSync(fileName)) return undefined;
	return fs.readFileSync(fileName, "utf8").split(/\r?\n/)[line - 1];
}

function spanLocation(fileName: string, textSpan: ts.TextSpan, cwd: string): SpanLocation {
	const start = lineAndColumn(fileName, textSpan.start);
	const end = lineAndColumn(fileName, textSpan.start + textSpan.length);
	return {
		filePath: projectPath(fileName, cwd),
		line: start.line,
		column: start.column,
		endLine: end.line,
		endColumn: end.column,
		text: sourceLine(fileName, start.line),
	};
}

function prepareServiceAtLocation(params: LocationParams, cwd: string): ServiceAtLocation {
	const fileName = ensureInsideCwd(path.resolve(cwd, params.filePath), cwd);
	const parsed = parseProject(fileName, cwd);
	return {
		service: createLanguageService(parsed, fileName, cwd),
		fileName,
		position: sourcePosition(fileName, params.line, params.column),
	};
}

function summarizeEdits(edits: readonly FileEdit[], cwd: string): unknown {
	return edits.map((edit) => ({
		filePath: path.relative(cwd, edit.fileName),
		replacements: edit.replacements.map((replacement) => ({
			...lineAndColumn(edit.fileName, replacement.start),
			length: replacement.length,
			text: replacement.text,
		})),
	}));
}

function renameSymbol(params: RenameParams, cwd: string): AgentToolResult<unknown> {
	const targetFile = ensureEditable(path.resolve(cwd, params.filePath), cwd);
	const parsed = parseProject(targetFile, cwd);
	const service = createLanguageService(parsed, targetFile, cwd);
	const position = sourcePosition(targetFile, params.line, params.column);
	const renameInfo = service.getRenameInfo(targetFile, position);

	if (!renameInfo.canRename) {
		return result(`Cannot rename symbol: ${renameInfo.localizedErrorMessage}`, { canRename: false, reason: renameInfo.localizedErrorMessage });
	}

	const locations = service.findRenameLocations(targetFile, position, false, false, true);
	if (locations === undefined || locations.length === 0) {
		return result("TypeScript found no rename locations.", { canRename: true, locations: 0 });
	}

	const edits = collectEdits(locations, params.newName, cwd);
	if (params.dryRun !== true) {
		for (const edit of edits) applyFileEdit(edit);
	}

	const details = {
		dryRun: params.dryRun === true,
		oldName: renameInfo.displayName,
		newName: params.newName,
		fileCount: edits.length,
		replacementCount: locations.length,
		edits: summarizeEdits(edits, cwd),
	};
	const verb = params.dryRun === true ? "Would rename" : "Renamed";
	return result(`${verb} ${renameInfo.displayName} to ${params.newName} in ${locations.length} location(s) across ${edits.length} file(s).\n${formatJson(details)}`, details);
}

function definitionDetails(definition: ts.DefinitionInfo, cwd: string): unknown {
	return {
		...spanLocation(definition.fileName, definition.textSpan, cwd),
		kind: definition.kind,
		name: definition.name,
		containerName: definition.containerName,
	};
}

function referenceDetails(reference: ts.ReferenceEntry, cwd: string): unknown {
	return {
		...spanLocation(reference.fileName, reference.textSpan, cwd),
		isWriteAccess: reference.isWriteAccess,
	};
}

function findReferences(params: LocationParams, cwd: string): AgentToolResult<unknown> {
	const { service, fileName, position } = prepareServiceAtLocation(params, cwd);
	const symbols = service.findReferences(fileName, position) ?? [];
	const details = {
		symbolCount: symbols.length,
		referenceCount: symbols.reduce((count, symbol) => count + symbol.references.length, 0),
		symbols: symbols.map((symbol) => ({
			definition: definitionDetails(symbol.definition, cwd),
			references: symbol.references.map((reference) => referenceDetails(reference, cwd)),
		})),
	};
	return result(`Found ${details.referenceCount} reference(s) across ${details.symbolCount} symbol group(s).\n${formatJson(details)}`, details);
}

function goToDefinition(params: LocationParams, cwd: string): AgentToolResult<unknown> {
	const { service, fileName, position } = prepareServiceAtLocation(params, cwd);
	const info = service.getDefinitionAndBoundSpan(fileName, position);
	const definitions = info?.definitions ?? [];
	const details = {
		definitionCount: definitions.length,
		textSpan: info === undefined ? undefined : spanLocation(fileName, info.textSpan, cwd),
		definitions: definitions.map((definition) => definitionDetails(definition, cwd)),
	};
	return result(`Found ${definitions.length} definition(s).\n${formatJson(details)}`, details);
}

function callHierarchyItemDetails(item: ts.CallHierarchyItem, cwd: string): unknown {
	return {
		...spanLocation(item.file, item.selectionSpan, cwd),
		declaration: spanLocation(item.file, item.span, cwd),
		kind: item.kind,
		name: item.name,
		containerName: item.containerName,
	};
}

function isCallHierarchyItem(value: ts.CallHierarchyItem | readonly ts.CallHierarchyItem[]): value is ts.CallHierarchyItem {
	return !Array.isArray(value);
}

function callHierarchyItems(value: ts.CallHierarchyItem | readonly ts.CallHierarchyItem[] | undefined): readonly ts.CallHierarchyItem[] {
	if (value === undefined) return [];
	return isCallHierarchyItem(value) ? [value] : value;
}

function callHierarchy(params: LocationParams, cwd: string): AgentToolResult<unknown> {
	const { service, fileName, position } = prepareServiceAtLocation(params, cwd);
	const items = callHierarchyItems(service.prepareCallHierarchy(fileName, position));
	const incoming = service.provideCallHierarchyIncomingCalls(fileName, position) ?? [];
	const outgoing = service.provideCallHierarchyOutgoingCalls(fileName, position) ?? [];
	const details = {
		itemCount: items.length,
		incomingCount: incoming.length,
		outgoingCount: outgoing.length,
		items: items.map((item) => callHierarchyItemDetails(item, cwd)),
		incoming: incoming.map((call) => ({
			from: callHierarchyItemDetails(call.from, cwd),
			fromSpans: call.fromSpans.map((span) => spanLocation(call.from.file, span, cwd)),
		})),
		outgoing: outgoing.map((call) => ({
			to: callHierarchyItemDetails(call.to, cwd),
			fromSpans: call.fromSpans.map((span) => spanLocation(fileName, span, cwd)),
		})),
	};
	return result(`Found ${incoming.length} incoming and ${outgoing.length} outgoing call(s).\n${formatJson(details)}`, details);
}

export default function typescriptRefactorExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ts_rename_symbol",
		label: "TS Rename Symbol",
		description: "Rename a TypeScript/JavaScript symbol using TypeScript's language service instead of manual occurrence edits.",
		promptSnippet: "Rename TypeScript/JavaScript symbols safely using TypeScript's language service.",
		promptGuidelines: [
			"Use ts_rename_symbol for TypeScript/JavaScript symbol renames instead of manually editing occurrences.",
			"Call ts_rename_symbol with the file path plus 1-based line and column of the existing symbol.",
		],
		parameters: RenameParams,
		async execute(_toolCallId, params: RenameParams, _signal, _onUpdate, ctx) {
			return renameSymbol(params, ctx.cwd);
		},
	});

	pi.registerTool({
		name: "ts_find_references",
		label: "TS Find References",
		description: "Find all TypeScript/JavaScript references to a symbol using TypeScript's language service.",
		promptSnippet: "Find TypeScript/JavaScript symbol references using TypeScript's language service.",
		promptGuidelines: [
			"Use ts_find_references for TypeScript/JavaScript symbol reference lookup instead of grep when line and column are known.",
			"Call ts_find_references with the file path plus 1-based line and column of the existing symbol.",
		],
		parameters: LocationParams,
		async execute(_toolCallId, params: LocationParams, _signal, _onUpdate, ctx) {
			return findReferences(params, ctx.cwd);
		},
	});

	pi.registerTool({
		name: "ts_go_to_definition",
		label: "TS Go To Definition",
		description: "Resolve TypeScript/JavaScript symbol definitions using TypeScript's language service.",
		promptSnippet: "Go to TypeScript/JavaScript symbol definitions using TypeScript's language service.",
		promptGuidelines: [
			"Use ts_go_to_definition for TypeScript/JavaScript symbol navigation instead of grep when line and column are known.",
			"Call ts_go_to_definition with the file path plus 1-based line and column of the existing symbol.",
		],
		parameters: LocationParams,
		async execute(_toolCallId, params: LocationParams, _signal, _onUpdate, ctx) {
			return goToDefinition(params, ctx.cwd);
		},
	});

	pi.registerTool({
		name: "ts_call_hierarchy",
		label: "TS Call Hierarchy",
		description: "Return incoming and outgoing TypeScript/JavaScript calls for a function-like symbol using TypeScript's language service.",
		promptSnippet: "Inspect TypeScript/JavaScript incoming and outgoing call hierarchy.",
		promptGuidelines: [
			"Use ts_call_hierarchy to understand callers/callees of TypeScript/JavaScript functions and methods when line and column are known.",
			"Call ts_call_hierarchy with the file path plus 1-based line and column of the function-like symbol.",
		],
		parameters: LocationParams,
		async execute(_toolCallId, params: LocationParams, _signal, _onUpdate, ctx) {
			return callHierarchy(params, ctx.cwd);
		},
	});
}
