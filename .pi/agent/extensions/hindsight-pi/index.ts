import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { HindsightClient } from "@vectorize-io/hindsight-client";

interface Config {
  autoRecall: boolean;
  autoRetain: boolean;
  retainMode: "full-session" | "last-turn";
  retainEveryNTurns: number;
  retainOverlapTurns: number;
  retainContext: string;
  retainTags: string[];
  retainMetadata: Record<string, string>;
  recallBudget: "low" | "mid" | "high";
  recallMaxTokens: number;
  recallTypes: string[];
  recallContextTurns: number;
  recallMaxQueryChars: number;
  recallPromptPreamble: string;
  recallTags: string[];
  recallTagsMatch: "any" | "all" | "any_strict" | "all_strict";
  hindsightApiUrl: string | null;
  hindsightApiToken: string | null;
  bankId: string | null;
  bankIdPrefix: string;
  dynamicBankId: boolean;
  dynamicBankGranularity: string[];
  bankMission: string;
  retainMission: string | null;
  agentName: string;
  debug: boolean;
  verbose: boolean;
}

interface Message { role: "user" | "assistant"; content: string }
interface State { missionsSet: Set<string>; lastRetainedTurn: Map<string, number> }

const defaults: Config = {
  autoRecall: true,
  autoRetain: true,
  retainMode: "full-session",
  retainEveryNTurns: 3,
  retainOverlapTurns: 2,
  retainContext: "pi",
  retainTags: [],
  retainMetadata: {},
  recallBudget: "mid",
  recallMaxTokens: 1024,
  recallTypes: ["world", "experience"],
  recallContextTurns: 1,
  recallMaxQueryChars: 800,
  recallPromptPreamble: "Relevant memories from past conversations (prioritize recent when conflicting). Only use memories that are directly useful to continue this conversation; ignore the rest:",
  recallTags: [],
  recallTagsMatch: "any",
  hindsightApiUrl: null,
  hindsightApiToken: null,
  bankId: null,
  bankIdPrefix: "",
  dynamicBankId: false,
  dynamicBankGranularity: ["agent", "project"],
  bankMission: "",
  retainMission: null,
  agentName: "pi",
  debug: false,
  verbose: false,
};

const state: State = { missionsSet: new Set(), lastRetainedTurn: new Map() };

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config.hindsightApiUrl) {
    console.error("[Hindsight] No API URL configured. Set HINDSIGHT_API_URL or ~/.hindsight/pi.json");
    return;
  }

  const client = new HindsightClient({ baseUrl: config.hindsightApiUrl, apiKey: config.hindsightApiToken ?? undefined });
  const bankId = deriveBankId(config, process.cwd());
  debug(config, `Initialized with bank: ${bankId}, API: ${config.hindsightApiUrl}`);

  pi.registerTool({
    name: "hindsight_retain",
    label: "Hindsight Retain",
    description: "Store information in long-term memory.",
    promptSnippet: "Store important facts, preferences, project context, and decisions in Hindsight memory.",
    promptGuidelines: ["Use hindsight_retain to remember important user preferences, project context, decisions, and facts worth recalling in future sessions."],
    parameters: Type.Object({ content: Type.String({ description: "Self-contained information to remember." }), context: Type.Optional(Type.String({ description: "Optional source/context." })) }),
    async execute(_toolCallId, params) {
      await ensureBankMission(client, bankId, config, state.missionsSet);
      await client.retain(bankId, params.content, { context: params.context ?? config.retainContext, tags: optionalArray(config.retainTags), metadata: optionalRecord(config.retainMetadata) });
      return { content: [{ type: "text", text: "Memory stored successfully." }], details: {} };
    },
  });

  pi.registerTool({
    name: "hindsight_recall",
    label: "Hindsight Recall",
    description: "Search long-term memory for relevant information.",
    promptSnippet: "Search Hindsight memory for past conversations, user preferences, and project history.",
    promptGuidelines: ["Use hindsight_recall proactively before answering questions about past conversations, user preferences, project history, or any topic where prior context would help."],
    parameters: Type.Object({ query: Type.String({ description: "Natural-language search query." }) }),
    async execute(_toolCallId, params) {
      const results = await recall(client, bankId, config, params.query);
      const text = results.length ? `Found ${results.length} relevant memories (as of ${formatCurrentTime()} UTC):\n\n${formatMemories(results)}` : "No relevant memories found.";
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "hindsight_reflect",
    label: "Hindsight Reflect",
    description: "Generate a synthesized answer using long-term memory.",
    promptSnippet: "Ask Hindsight to synthesize memories into a coherent answer.",
    promptGuidelines: ["Use hindsight_reflect when the user asks for a memory-backed summary or synthesis."],
    parameters: Type.Object({ query: Type.String({ description: "Question to answer from memory." }), context: Type.Optional(Type.String({ description: "Optional extra context." })) }),
    async execute(_toolCallId, params) {
      await ensureBankMission(client, bankId, config, state.missionsSet);
      const response = await client.reflect(bankId, params.query, { context: params.context, budget: config.recallBudget });
      return { content: [{ type: "text", text: response.text || "No relevant information found to reflect on." }], details: {} };
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!config.autoRecall) return;
    await ensureBankMission(client, bankId, config, state.missionsSet);
    const history = messagesFromEntries(ctx.sessionManager.getBranch());
    const query = truncateRecallQuery(composeRecallQuery(event.prompt, history, config.recallContextTurns), event.prompt, config.recallMaxQueryChars);
    const results = await recall(client, bankId, config, query);
    if (!results.length) return;
    const formatted = formatMemories(results);
    ctx.ui.notify(`Hindsight recalled ${pluralize(results.length, "memory", "memories")} from ${bankId}.`, "info");
    verboseLog(config, `Recalled ${pluralize(results.length, "memory", "memories")} from ${bankId}:\n${formatted}`);
    return { systemPrompt: `${event.systemPrompt}\n\n<hindsight_memories>\n${config.recallPromptPreamble}\nCurrent time: ${formatCurrentTime()} UTC\n\n${formatted}\n</hindsight_memories>` };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!config.autoRetain) return;
    const retained = await retainSession(client, bankId, config, state, ctx);
    if (retained) {
      ctx.ui.notify(`Hindsight retained ${pluralize(retained.messageCount, "message")} to ${bankId}.`, "info");
      verboseLog(config, `Retained ${pluralize(retained.messageCount, "message")} to ${bankId}:\n${retained.transcript}`);
    }
  });

  // NOTE: upstream OpenCode plugin also injects recalled memories into the
  // compaction context via output.context.push(). Pi's session_before_compact
  // can only replace the whole compaction (summary + firstKeptEntryId), so we
  // intentionally limit ourselves to retaining the pre-compaction transcript.
  pi.on("session_before_compact", async (_event, ctx) => {
    if (!config.autoRetain) return;
    const retained = await retainSession(client, bankId, config, state, ctx, true);
    if (retained) {
      // Reset turn tracking; after compaction the message list shrinks, so the
      // old lastRetainedTurn would block future auto-retains.
      const sessionId = ctx.sessionManager.getSessionFile() || "ephemeral";
      state.lastRetainedTurn.delete(sessionId);
      ctx.ui.notify(`Hindsight retained ${pluralize(retained.messageCount, "message")} before compaction.`, "info");
      verboseLog(config, `Retained ${pluralize(retained.messageCount, "message")} before compaction to ${bankId}:\n${retained.transcript}`);
    }
  });
}

function loadConfig(): Config {
  const file = readJson(join(homedir(), ".hindsight", "pi.json"));
  const config = { ...defaults, ...file };
  setString(config, "hindsightApiUrl", process.env.HINDSIGHT_API_URL);
  setString(config, "hindsightApiToken", process.env.HINDSIGHT_API_TOKEN);
  setString(config, "bankId", process.env.HINDSIGHT_BANK_ID);
  setString(config, "agentName", process.env.HINDSIGHT_AGENT_NAME);
  setString(config, "bankMission", process.env.HINDSIGHT_BANK_MISSION);
  setBool(config, "autoRecall", process.env.HINDSIGHT_AUTO_RECALL);
  setBool(config, "autoRetain", process.env.HINDSIGHT_AUTO_RETAIN);
  setBool(config, "dynamicBankId", process.env.HINDSIGHT_DYNAMIC_BANK_ID);
  setBool(config, "debug", process.env.HINDSIGHT_DEBUG);
  setBool(config, "verbose", process.env.HINDSIGHT_VERBOSE);
  setInt(config, "recallMaxTokens", process.env.HINDSIGHT_RECALL_MAX_TOKENS);
  setInt(config, "recallMaxQueryChars", process.env.HINDSIGHT_RECALL_MAX_QUERY_CHARS);
  setInt(config, "recallContextTurns", process.env.HINDSIGHT_RECALL_CONTEXT_TURNS);
  const budget = process.env.HINDSIGHT_RECALL_BUDGET;
  if (budget === "low" || budget === "mid" || budget === "high") config.recallBudget = budget;
  const mode = process.env.HINDSIGHT_RETAIN_MODE;
  if (mode === "full-session" || mode === "last-turn") config.retainMode = mode;
  const tags = process.env.HINDSIGHT_RECALL_TAGS;
  if (tags) config.recallTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  return config;
}

function readJson(path: string): Partial<Config> { try { const parsed: unknown = JSON.parse(readFileSync(path, "utf-8")); return isRecord(parsed) ? parsed : {}; } catch { return {}; } }
function setString(config: Config, key: keyof Config, value: string | undefined): void { if (value !== undefined) Object.assign(config, { [key]: value }); }
function setBool(config: Config, key: keyof Config, value: string | undefined): void { if (value !== undefined) Object.assign(config, { [key]: ["true", "1", "yes"].includes(value.toLowerCase()) }); }
function setInt(config: Config, key: keyof Config, value: string | undefined): void { if (value !== undefined) { const n = Number.parseInt(value, 10); if (Number.isFinite(n)) Object.assign(config, { [key]: n }); } }
function optionalArray(values: string[]): string[] | undefined { return values.length ? values : undefined; }
function optionalRecord(values: Record<string, string>): Record<string, string> | undefined { return Object.keys(values).length ? values : undefined; }
function debug(config: Config, ...args: unknown[]): void { if (config.debug) console.error("[Hindsight]", ...args); }
function verboseLog(config: Config, message: string): void { if (config.verbose) console.error(`[Hindsight verbose] ${message}`); }

const VALID_BANK_FIELDS = new Set(["agent", "project", "gitProject", "channel", "user"]);
function deriveBankId(config: Config, directory: string): string {
  if (!config.dynamicBankId) return config.bankId ? withPrefix(config, config.bankId) : withPrefix(config, "pi");
  const fields = config.dynamicBankGranularity.length ? config.dynamicBankGranularity : ["agent", "project"];
  for (const field of fields) {
    if (!VALID_BANK_FIELDS.has(field)) console.error(`[Hindsight] Unknown dynamicBankGranularity field "${field}" — valid: ${[...VALID_BANK_FIELDS].sort().join(", ")}`);
  }
  const resolvers: Record<string, () => string> = { agent: () => config.agentName || "pi", project: () => basename(directory || "unknown"), gitProject: () => deriveGitProjectName(directory), channel: () => process.env.HINDSIGHT_CHANNEL_ID || "default", user: () => process.env.HINDSIGHT_USER_ID || "anonymous" };
  return withPrefix(config, fields.map((field) => resolvers[field]?.() ?? "unknown").join("::"));
}
function withPrefix(config: Config, value: string): string { return config.bankIdPrefix ? `${config.bankIdPrefix}-${value}` : value; }
function deriveGitProjectName(directory: string): string { const root = getProjectRootFromGit(directory); return basename(root || directory || "unknown"); }
function getProjectRootFromGit(directory: string): string | null { try { const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: directory, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim(); return basename(common) === ".git" ? dirname(common) : common; } catch { return null; } }

async function ensureBankMission(client: HindsightClient, bankId: string, config: Config, missionsSet: Set<string>): Promise<void> {
  if (!config.bankMission.trim() || missionsSet.has(bankId)) return;
  try {
    await client.createBank(bankId, { reflectMission: config.bankMission, retainMission: config.retainMission ?? undefined });
    missionsSet.add(bankId);
    if (missionsSet.size > 10000) {
      const keys = [...missionsSet].sort();
      for (const k of keys.slice(0, keys.length >> 1)) missionsSet.delete(k);
    }
  } catch (error) { debug(config, `Could not set bank mission for ${bankId}:`, error); }
}

async function recall(client: HindsightClient, bankId: string, config: Config, query: string) {
  const response = await client.recall(bankId, query, { budget: config.recallBudget, maxTokens: config.recallMaxTokens, types: config.recallTypes, tags: optionalArray(config.recallTags), tagsMatch: optionalArray(config.recallTags) ? config.recallTagsMatch : undefined });
  return response.results || [];
}

async function retainSession(client: HindsightClient, bankId: string, config: Config, state: State, ctx: ExtensionContext, force = false): Promise<{ messageCount: number; transcript: string } | null> {
  const sessionId = ctx.sessionManager.getSessionFile() || "ephemeral";
  const messages = messagesFromEntries(ctx.sessionManager.getBranch());
  const userTurns = messages.filter((message) => message.role === "user").length;
  const lastRetained = state.lastRetainedTurn.get(sessionId) ?? 0;
  if (!force && userTurns - lastRetained < config.retainEveryNTurns) return null;
  const retainFullWindow = config.retainMode === "full-session";
  const windowTurns = retainFullWindow ? Number.MAX_SAFE_INTEGER : config.retainEveryNTurns + config.retainOverlapTurns;
  const target = sliceLastTurnsByUserBoundary(messages, windowTurns);
  // The caller has already sliced to the desired window, so always retain the
  // full target slice here (mirrors upstream `prepareRetentionTranscript(target, true)`).
  const retention = prepareRetentionTranscript(target, true);
  if (!retention) return null;
  await ensureBankMission(client, bankId, config, state.missionsSet);
  const metadata = Object.keys(config.retainMetadata).length ? { ...config.retainMetadata, session_id: sessionId } : { session_id: sessionId };
  await client.retain(bankId, retention.transcript, { documentId: retainFullWindow ? sessionId : `${sessionId}-${Date.now()}`, context: config.retainContext, tags: optionalArray(config.retainTags), metadata, async: true });
  state.lastRetainedTurn.set(sessionId, userTurns);
  return { messageCount: retention.messageCount, transcript: retention.transcript };
}

function messagesFromEntries(entries: readonly unknown[]): Message[] { return entries.map(messageFromEntry).filter(isMessage); }
function messageFromEntry(entry: unknown): Message | null {
  if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return null;
  const role = entry.message.role;
  if (role !== "user" && role !== "assistant") return null;
  const text = contentToText(entry.message.content).trim();
  return text ? { role, content: text } : null;
}
function isMessage(value: Message | null): value is Message { return value !== null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function contentToText(content: unknown): string { if (typeof content === "string") return content; if (!Array.isArray(content)) return ""; return content.map((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n"); }
function stripMemoryTags(content: string): string { return content.replace(/<hindsight_memories>[\s\S]*?<\/hindsight_memories>/g, "").replace(/<relevant_memories>[\s\S]*?<\/relevant_memories>/g, ""); }
function formatCurrentTime(): string { const now = new Date(); return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`; }
function pad(value: number): string { return String(value).padStart(2, "0"); }
function formatMemories(results: readonly { text: string; type?: string | null; mentioned_at?: string | null }[]): string { return results.map((result) => `- ${result.text}${result.type ? ` [${result.type}]` : ""}${result.mentioned_at ? ` (${result.mentioned_at})` : ""}`).join("\n\n"); }
function composeRecallQuery(latestQuery: string, messages: Message[], turns: number): string {
  const latest = latestQuery.trim();
  if (turns <= 1 || !messages.length) return latest;
  const lines: string[] = [];
  for (const message of sliceLastTurnsByUserBoundary(messages, turns)) {
    const content = stripMemoryTags(message.content).trim();
    if (!content) continue;
    if (message.role === "user" && content === latest) continue;
    lines.push(`${message.role}: ${content}`);
  }
  return lines.length ? `Prior context:\n\n${lines.join("\n")}\n\n${latest}` : latest;
}
function truncateRecallQuery(query: string, latestQuery: string, maxChars: number): string {
  if (maxChars <= 0 || query.length <= maxChars) return query;
  const latest = latestQuery.trim();
  const latestOnly = latest.length > maxChars ? latest.slice(0, maxChars) : latest;
  const contextMarker = "Prior context:\n\n";
  const markerIndex = query.indexOf(contextMarker);
  if (markerIndex === -1) return latestOnly;
  const suffix = `\n\n${latest}`;
  const suffixIndex = query.lastIndexOf(suffix);
  if (suffixIndex === -1 || suffix.length >= maxChars) return latestOnly;
  const contextLines = query.slice(markerIndex + contextMarker.length, suffixIndex).split("\n").filter(Boolean);
  const kept: string[] = [];
  for (let i = contextLines.length - 1; i >= 0; i--) {
    kept.unshift(contextLines[i]);
    if (`${contextMarker}${kept.join("\n")}${suffix}`.length > maxChars) { kept.shift(); break; }
  }
  return kept.length ? `${contextMarker}${kept.join("\n")}${suffix}` : latestOnly;
}
function sliceLastTurnsByUserBoundary(messages: Message[], turns: number): Message[] {
  if (!messages.length || turns <= 0) return [];
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      seen++;
      if (seen >= turns) return messages.slice(i);
    }
  }
  return [...messages];
}
function prepareRetentionTranscript(messages: Message[], retainFullWindow: boolean): { transcript: string; messageCount: number } | null {
  if (!messages.length) return null;
  let target: Message[];
  if (retainFullWindow) {
    target = messages;
  } else {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === "user") { lastUserIdx = i; break; } }
    if (lastUserIdx === -1) return null;
    target = messages.slice(lastUserIdx);
  }
  const parts = target.map((message) => { const content = stripMemoryTags(message.content).trim(); return content ? `[role: ${message.role}]\n${content}\n[${message.role}:end]` : ""; }).filter(Boolean);
  if (!parts.length) return null;
  const transcript = parts.join("\n\n");
  return transcript.trim().length >= 10 ? { transcript, messageCount: parts.length } : null;
}
function pluralize(count: number, singular: string, plural = `${singular}s`): string { return `${count} ${count === 1 ? singular : plural}`; }
