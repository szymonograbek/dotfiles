#!/usr/bin/env node
// Thin Sentry REST API client for the sentry-api skill.
//
// Auth is loaded from env first, then macOS Keychain:
//   Token:    SENTRY_AUTH_TOKEN; keychain service SENTRY_AUTH_TOKEN
//   Org:      SENTRY_ORG; keychain service SENTRY_ORG (optional default)
//   Base URL: SENTRY_BASE_URL; keychain service SENTRY_BASE_URL (default https://sentry.io)
//
// Commands emit compact, agent-readable JSON by default. Use `request` for raw API output.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function stripEnvQuotes(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadDotEnvFile(fileName) {
  const path = join(process.cwd(), fileName);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const [, name, rawValue = ""] = match;
    if (process.env[name] !== undefined) continue;
    process.env[name] = stripEnvQuotes(rawValue);
  }
}

function loadDotEnvFiles() {
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const names = [
    `.env.${nodeEnv}.local`,
    ".env.local",
    `.env.${nodeEnv}`,
    ".env",
  ];
  for (const name of names) loadDotEnvFile(name);
}

loadDotEnvFiles();

function keychain(service, account) {
  if (process.platform !== "darwin") return null;
  const args = ["find-generic-password", "-s", service, "-w"];
  if (account) args.splice(1, 0, "-a", account);
  try {
    const out = execFileSync("security", args, { stdio: ["ignore", "pipe", "ignore"] });
    const value = out.toString("utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function firstKeychain(services, accounts) {
  for (const service of services) {
    for (const account of accounts) {
      const value = keychain(service, account);
      if (value) return value;
    }
  }
  return null;
}

function loadConfig() {
  const token = firstEnv(["SENTRY_AUTH_TOKEN"])
    ?? firstKeychain(["SENTRY_AUTH_TOKEN"], [process.env.USER || ""]);
  const org = firstEnv(["SENTRY_ORG"])
    ?? firstKeychain(["SENTRY_ORG"], [process.env.USER || ""]);
  const baseUrl = firstEnv(["SENTRY_BASE_URL"])
    ?? firstKeychain(["SENTRY_BASE_URL"], [process.env.USER || ""])
    ?? "https://sentry.io";

  if (!token) {
    throw new Error("Missing Sentry credentials: SENTRY_AUTH_TOKEN. Set env var or store it in macOS Keychain.");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), org, token };
}

const config = loadConfig();

function sentryUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${config.baseUrl}${normalized}`;
}

class ApiError extends Error {
  constructor(method, path, status, statusText, responseText) {
    super(`${method} ${path} -> ${status} ${statusText}: ${responseText}`);
    this.status = status;
  }
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid JSON: ${message}`);
  }
}

function nextCursor(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const hasNextRel = /rel="next"/.test(part);
    const hasResults = /results="true"/.test(part);
    const match = part.match(/[?&]cursor=([^&>]+)/);
    if (hasNextRel && hasResults && match) return decodeURIComponent(match[1]);
  }
  return null;
}

async function requestWithHeaders(method, path, body) {
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
    },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(sentryUrl(path), init);
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(method, path, res.status, res.statusText, text);
  }
  return {
    body: text ? parseJson(text, "response") : null,
    nextCursor: nextCursor(res.headers.get("link")),
  };
}

async function request(method, path, body) {
  const response = await requestWithHeaders(method, path, body);
  return response.body;
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function defaultOrg() {
  if (config.org) return config.org;
  const body = await request("GET", "/api/0/organizations/");
  if (Array.isArray(body) && body.length === 1 && typeof body[0]?.slug === "string") return body[0].slug;
  throw new Error("org is required: pass --org <org> or set SENTRY_ORG");
}

function explicitOrgArgs(args) {
  if (args[0] !== "--org") return null;
  if (args.length < 3) throw new Error("--org requires <org> <project>");
  return { org: args[1], project: args[2], rest: args.slice(3) };
}

async function orgIssueArgs(args, usage) {
  if (args[0] === "--org") {
    if (args.length < 3) throw new Error(`usage: ${usage}`);
    return { org: args[1], issueId: args[2], rest: args.slice(3) };
  }
  if (args.length >= 1) {
    return { org: await defaultOrg(), issueId: args[0], rest: args.slice(1) };
  }
  throw new Error(`usage: ${usage}`);
}

async function orgProjectWithDefault(args, usage) {
  const explicit = explicitOrgArgs(args);
  if (explicit) return explicit;
  if (args.length >= 1) {
    return { org: await defaultOrg(), project: args[0], rest: args.slice(1) };
  }
  throw new Error(`usage: ${usage}`);
}

function compactOrganization(org) {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    status: org.status?.name || org.status?.id || null,
  };
}

function compactProject(project) {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    platform: project.platform,
    status: project.status,
    dateCreated: project.dateCreated,
  };
}

function compactIssue(issue) {
  return {
    id: issue.id,
    shortId: issue.shortId,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    status: issue.status,
    count: issue.count,
    userCount: issue.userCount,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    project: issue.project ? compactProject(issue.project) : undefined,
    permalink: issue.permalink,
  };
}

function stacktraceFromEntry(entry) {
  if (entry.type !== "exception") return [];
  const values = Array.isArray(entry.data?.values) ? entry.data.values : [];
  return values.flatMap((value) => {
    const frames = Array.isArray(value.stacktrace?.frames) ? value.stacktrace.frames : [];
    return frames.map((frame) => ({
      function: frame.function,
      module: frame.module,
      filename: frame.filename,
      lineNo: frame.lineNo,
      colNo: frame.colNo,
      inApp: frame.inApp,
      contextLine: frame.context?.[1]?.[1],
    }));
  });
}

function compactEvent(event) {
  const entries = Array.isArray(event.entries) ? event.entries : [];
  return {
    id: event.id,
    eventID: event.eventID,
    title: event.title,
    message: event.message,
    platform: event.platform,
    dateCreated: event.dateCreated,
    dist: event.dist,
    environment: event.environment,
    release: event.release?.version || event.release,
    user: event.user,
    tags: event.tags,
    contexts: event.contexts,
    stacktrace: entries.flatMap(stacktraceFromEntry),
  };
}

function positiveInt(raw, fallback, name) {
  const value = Number.parseInt(raw || String(fallback), 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function compactFrame(frame) {
  return {
    module: frame.module,
    function: frame.function,
    filename: frame.filename,
    lineNo: frame.lineNo,
    colNo: frame.colNo,
    inApp: frame.inApp,
    contextLine: frame.context?.[1]?.[1],
  };
}

function compactException(entry, frameLimit) {
  const values = Array.isArray(entry.data?.values) ? entry.data.values : [];
  return values.map((value) => {
    const frames = Array.isArray(value.stacktrace?.frames) ? value.stacktrace.frames : [];
    return {
      type: value.type,
      value: value.value,
      module: value.module,
      mechanism: value.mechanism,
      frames: frames.slice(-frameLimit).map(compactFrame),
    };
  });
}

function compactBreadcrumb(crumb) {
  return {
    timestamp: crumb.timestamp,
    type: crumb.type,
    category: crumb.category,
    level: crumb.level,
    message: crumb.message,
    data: crumb.data,
    state: crumb.state,
    event_id: crumb.event_id,
  };
}

function compactEventDebug(event, breadcrumbLimitRaw, frameLimitRaw) {
  const breadcrumbLimit = positiveInt(breadcrumbLimitRaw, 40, "breadcrumbLimit");
  const frameLimit = positiveInt(frameLimitRaw, 5, "frameLimit");
  const entries = Array.isArray(event.entries) ? event.entries : [];
  const exceptionEntry = entries.find((entry) => entry.type === "exception");
  const breadcrumbEntry = entries.find((entry) => entry.type === "breadcrumbs");
  const breadcrumbs = Array.isArray(breadcrumbEntry?.data?.values) ? breadcrumbEntry.data.values : [];
  return {
    event: compactEvent(event),
    entryTypes: entries.map((entry) => entry.type),
    exceptions: exceptionEntry ? compactException(exceptionEntry, frameLimit) : [],
    breadcrumbs: breadcrumbs.slice(-breadcrumbLimit).map(compactBreadcrumb),
  };
}

function compactTag(tag) {
  return {
    key: tag.key,
    name: tag.name,
    totalValues: tag.totalValues,
  };
}

function compactTagValue(value) {
  return {
    value: value.value,
    count: value.count,
    firstSeen: value.firstSeen,
    lastSeen: value.lastSeen,
  };
}

function compactRelease(release) {
  return {
    version: release.version,
    shortVersion: release.shortVersion,
    dateCreated: release.dateCreated,
    dateReleased: release.dateReleased,
    newGroups: release.newGroups,
    projects: release.projects,
  };
}

async function paged(path, limitRaw, mapItem, key) {
  const limit = positiveInt(limitRaw, 50, "limit");

  const items = [];
  let cursor = null;
  do {
    const url = new URL(sentryUrl(path));
    url.searchParams.set("limit", String(Math.min(100, limit - items.length)));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await requestWithHeaders("GET", url.toString());
    if (Array.isArray(response.body)) items.push(...response.body);
    cursor = response.nextCursor;
  } while (cursor && items.length < limit);

  return { [key]: items.slice(0, limit).map(mapItem), totalReturned: Math.min(items.length, limit), hasMore: Boolean(cursor), nextCursor: cursor };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "me":
      try {
        return emit(await request("GET", "/api/0/users/me/"));
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          const body = await request("GET", "/api/0/organizations/");
          return emit({ user: null, note: "Current token cannot read /users/me; this is expected for some organization/internal tokens.", organizations: Array.isArray(body) ? body.map(compactOrganization) : [] });
        }
        throw error;
      }
    case "organizations": {
      const body = await request("GET", "/api/0/organizations/");
      return emit({ organizations: Array.isArray(body) ? body.map(compactOrganization) : [] });
    }
    case "projects": {
      const org = args[0] || await defaultOrg();
      const body = await request("GET", `/api/0/organizations/${encodeURIComponent(org)}/projects/`);
      return emit({ projects: Array.isArray(body) ? body.map(compactProject) : [] });
    }
    case "issues": {
      const parsed = await orgProjectWithDefault(args, "issues <project> [query] [limit] OR issues --org <org> <project> [query] [limit]");
      const query = parsed.rest[0] || "is:unresolved";
      const limit = parsed.rest[1];
      const url = new URL(sentryUrl(`/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/`));
      url.searchParams.set("project", parsed.project);
      url.searchParams.set("query", query);
      return emit(await paged(url.toString(), limit, compactIssue, "issues"));
    }
    case "issue": {
      const parsed = await orgIssueArgs(args, "issue <issueId> OR issue --org <org> <issueId>");
      return emit(compactIssue(await request("GET", `/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/${encodeURIComponent(parsed.issueId)}/`)));
    }
    case "events": {
      const parsed = await orgIssueArgs(args, "events <issueId> [limit] OR events --org <org> <issueId> [limit]");
      return emit(await paged(`/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/${encodeURIComponent(parsed.issueId)}/events/`, parsed.rest[0], compactEvent, "events"));
    }
    case "latest-event": {
      const parsed = await orgIssueArgs(args, "latest-event <issueId> OR latest-event --org <org> <issueId>");
      return emit(compactEvent(await request("GET", `/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/${encodeURIComponent(parsed.issueId)}/events/latest/`)));
    }
    case "event": {
      const parsed = await orgIssueArgs(args, "event <issueId> <eventId> OR event --org <org> <issueId> <eventId>");
      const eventId = parsed.rest[0];
      if (!eventId) throw new Error("usage: event <issueId> <eventId> OR event --org <org> <issueId> <eventId>");
      return emit(compactEvent(await request("GET", `/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/${encodeURIComponent(parsed.issueId)}/events/${encodeURIComponent(eventId)}/`)));
    }
    case "event-debug": {
      const parsed = await orgIssueArgs(args, "event-debug <issueId> <eventId> [breadcrumbLimit] [frameLimit] OR event-debug --org <org> <issueId> <eventId> [breadcrumbLimit] [frameLimit]");
      const [eventId, breadcrumbLimit, frameLimit] = parsed.rest;
      if (!eventId) throw new Error("usage: event-debug <issueId> <eventId> [breadcrumbLimit] [frameLimit] OR event-debug --org <org> <issueId> <eventId> [breadcrumbLimit] [frameLimit]");
      const event = await request("GET", `/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/${encodeURIComponent(parsed.issueId)}/events/${encodeURIComponent(eventId)}/`);
      return emit(compactEventDebug(event, breadcrumbLimit, frameLimit));
    }
    case "latest-debug": {
      const parsed = await orgIssueArgs(args, "latest-debug <issueId> [breadcrumbLimit] [frameLimit] OR latest-debug --org <org> <issueId> [breadcrumbLimit] [frameLimit]");
      const [breadcrumbLimit, frameLimit] = parsed.rest;
      const event = await request("GET", `/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/${encodeURIComponent(parsed.issueId)}/events/latest/`);
      return emit(compactEventDebug(event, breadcrumbLimit, frameLimit));
    }
    case "tags": {
      const parsed = await orgIssueArgs(args, "tags <issueId> OR tags --org <org> <issueId>");
      const body = await request("GET", `/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/${encodeURIComponent(parsed.issueId)}/tags/`);
      return emit({ tags: Array.isArray(body) ? body.map(compactTag) : [] });
    }
    case "tag-values": {
      const parsed = await orgIssueArgs(args, "tag-values <issueId> <tag> [limit] OR tag-values --org <org> <issueId> <tag> [limit]");
      const [tag, limit] = parsed.rest;
      if (!tag) throw new Error("usage: tag-values <issueId> <tag> [limit] OR tag-values --org <org> <issueId> <tag> [limit]");
      return emit(await paged(`/api/0/organizations/${encodeURIComponent(parsed.org)}/issues/${encodeURIComponent(parsed.issueId)}/tags/${encodeURIComponent(tag)}/values/`, limit, compactTagValue, "tagValues"));
    }
    case "releases": {
      const parsed = await orgProjectWithDefault(args, "releases <project> [limit] OR releases --org <org> <project> [limit]");
      return emit(await paged(`/api/0/projects/${encodeURIComponent(parsed.org)}/${encodeURIComponent(parsed.project)}/releases/`, parsed.rest[0], compactRelease, "releases"));
    }
    case "request": {
      const [method, path, rawBody] = args;
      if (!method || !path) throw new Error("usage: request <method> <path> [jsonBody]");
      const body = rawBody ? parseJson(rawBody, "body") : undefined;
      return emit(await request(method.toUpperCase(), path, body));
    }
    default:
      throw new Error(`unknown command: ${cmd || "(none)"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
