#!/usr/bin/env node
// Thin Todoist client for the daily-todoist-work skill.
//
// Auth: reads the Todoist API token from, in order:
//   1. $TODOIST_API_KEY
//   2. macOS Keychain: `security find-generic-password -a "$USER" -s TODOIST_API_KEY -w`
//      Add it once with:
//        security add-generic-password -a "$USER" -s TODOIST_API_KEY -w 'YOUR_TOKEN'
//
// Subcommands (all output JSON on stdout; non-zero exit on hard error):
//
//   projects
//     -> [ { id, name, ... } ]
//
//   sections <projectId>
//     -> [ { id, name, project_id } ]
//
//   tasks <projectId>
//     List OPEN tasks in a project (paginates).
//     -> [ { id, content, description, project_id, section_id, ... } ]
//
//   completed <projectId> <sinceISO> <untilISO>
//     List tasks COMPLETED in [since, until] in the project (Sync v9).
//     ISO timestamps, e.g. 2026-05-01T00:00:00Z. Range max 30 days; the script
//     auto-chunks longer ranges.
//     -> [ { task_id, content, completed_at, project_id, ... } ]
//
//   add
//     Reads JSON from stdin: an array of { content, description?, projectId, sectionId? }.
//     Creates each task via REST v2.
//     -> [ { id, content, description, project_id, section_id, ... } ]
//
//   complete <id> [<id> ...]
//     Closes tasks (marks as completed *now*).
//     -> { closed: [...ids], failed: [ { id, error } ] }
//
//   complete-at
//     Reads JSON from stdin: an array of { id, dateCompleted } where dateCompleted
//     is an ISO 8601 UTC timestamp (e.g. "2026-05-02T14:00:00Z"). Uses the Sync
//     API's `item_complete` command to backdate the completion.
//     -> { closed: [...ids], failed: [ { id, error } ] }

import { execFileSync } from "node:child_process";

function loadToken() {
  if (process.env.TODOIST_API_KEY) return process.env.TODOIST_API_KEY.trim();
  if (process.platform === "darwin") {
    try {
      const out = execFileSync(
        "security",
        ["find-generic-password", "-a", process.env.USER || "", "-s", "TODOIST_API_KEY", "-w"],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      const tok = out.toString("utf8").trim();
      if (tok) return tok;
    } catch { /* not in keychain */ }
  }
  return null;
}

const TOKEN = loadToken();
if (!TOKEN) {
  console.error(
    "Todoist token not found. Set TODOIST_API_KEY, or store it in macOS Keychain:\n" +
    "  security add-generic-password -a \"$USER\" -s TODOIST_API_KEY -w 'YOUR_TOKEN'",
  );
  process.exit(2);
}

const API = "https://api.todoist.com/api/v1";

const headers = (extra = {}) => ({
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  ...extra,
});

async function req(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method || "GET"} ${url} -> ${res.status} ${res.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// Walk a cursor-paginated `{ results, next_cursor }` endpoint until exhausted.
async function paginated(path, params = {}) {
  const out = [];
  let cursor = null;
  do {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const body = await req(url.toString(), { headers: headers() });
    if (Array.isArray(body?.results)) out.push(...body.results);
    cursor = body?.next_cursor ?? null;
  } while (cursor);
  return out;
}

async function getProjects() {
  return paginated("/projects");
}

async function getSections(projectId) {
  return paginated("/sections", { project_id: projectId });
}

async function getOpenTasks(projectId) {
  return paginated("/tasks", { project_id: projectId });
}

async function getCompletedTasks(projectId, sinceISO, untilISO) {
  // /tasks/completed/by_completion_date returns { items, next_cursor? }.
  // The endpoint caps each call at ~3 months; auto-chunk to be safe.
  const start = new Date(sinceISO);
  const end = new Date(untilISO);
  if (isNaN(+start) || isNaN(+end)) throw new Error("invalid since/until ISO");
  const fmt = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const MAX_MS = 60 * 24 * 3600 * 1000; // 60 days per chunk
  const out = [];
  let chunkStart = start;
  while (chunkStart < end) {
    const chunkEnd = new Date(Math.min(+chunkStart + MAX_MS, +end));
    let cursor = null;
    do {
      const url = new URL(`${API}/tasks/completed/by_completion_date`);
      url.searchParams.set("project_id", projectId);
      url.searchParams.set("since", fmt(chunkStart));
      url.searchParams.set("until", fmt(chunkEnd));
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const body = await req(url.toString(), { headers: headers() });
      if (Array.isArray(body?.items)) out.push(...body.items);
      cursor = body?.next_cursor ?? null;
    } while (cursor);
    chunkStart = chunkEnd;
  }
  return out;
}

async function addTasks(specs) {
  const out = [];
  for (const s of specs) {
    if (!s.content || !s.projectId) throw new Error(`task missing content/projectId: ${JSON.stringify(s)}`);
    const payload = {
      content: s.content,
      description: s.description ?? "",
      project_id: s.projectId,
    };
    if (s.sectionId) payload.section_id = s.sectionId;
    const created = await req(`${API}/tasks`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    out.push(created);
  }
  return out;
}

async function completeTasks(ids) {
  const closed = [];
  const failed = [];
  for (const id of ids) {
    try {
      await req(`${API}/tasks/${encodeURIComponent(id)}/close`, {
        method: "POST",
        headers: headers(),
      });
      closed.push(id);
    } catch (e) {
      failed.push({ id, error: String(e.message || e) });
    }
  }
  return { closed, failed };
}

async function completeTasksAt(specs) {
  // Use Sync API: POST /api/v1/sync with commands=[{type:item_complete, args:{id, date_completed}}].
  // Submit in batches of 100 commands per Sync call (Todoist limit).
  const closed = [];
  const failed = [];
  const BATCH = 100;
  for (let i = 0; i < specs.length; i += BATCH) {
    const batch = specs.slice(i, i + BATCH);
    const commands = batch.map((s) => {
      if (!s.id || !s.dateCompleted) throw new Error(`complete-at: each item needs { id, dateCompleted }: ${JSON.stringify(s)}`);
      return {
        type: "item_complete",
        uuid: crypto.randomUUID(),
        args: { id: s.id, date_completed: s.dateCompleted },
      };
    });
    const form = new URLSearchParams();
    form.set("commands", JSON.stringify(commands));
    const res = await fetch(`${API}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST /sync -> ${res.status}: ${text}`);
    const body = JSON.parse(text);
    const status = body.sync_status || {};
    for (const cmd of commands) {
      const s = status[cmd.uuid];
      if (s === "ok") closed.push(cmd.args.id);
      else failed.push({ id: cmd.args.id, error: typeof s === "string" ? s : JSON.stringify(s) });
    }
  }
  return { closed, failed };
}

async function readStdinJSON() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function emit(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "projects":  return emit(await getProjects());
    case "sections":  return emit(await getSections(args[0]));
    case "tasks":     return emit(await getOpenTasks(args[0]));
    case "completed": return emit(await getCompletedTasks(args[0], args[1], args[2]));
    case "add": {
      const specs = await readStdinJSON();
      if (!Array.isArray(specs)) throw new Error("add: expected JSON array on stdin");
      return emit(await addTasks(specs));
    }
    case "complete": return emit(await completeTasks(args));
    case "complete-at": {
      const specs = await readStdinJSON();
      if (!Array.isArray(specs)) throw new Error("complete-at: expected JSON array on stdin");
      return emit(await completeTasksAt(specs));
    }
    default:
      console.error(`unknown command: ${cmd}\nsee top of script for usage`);
      process.exit(2);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
