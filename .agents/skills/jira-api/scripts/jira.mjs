#!/usr/bin/env node
// Thin Jira Cloud REST API client for the jira-api skill.
//
// Auth is loaded from env first, then macOS Keychain:
//   Base URL: JIRA_BASE_URL or ATLASSIAN_SITE_URL; keychain service JIRA_BASE_URL or ATLASSIAN_SITE_URL
//   Email:    JIRA_EMAIL or ATLASSIAN_EMAIL; keychain service JIRA_EMAIL or ATLASSIAN_EMAIL
//   Token:    JIRA_API_TOKEN or ATLASSIAN_API_TOKEN; keychain service JIRA_API_TOKEN or ATLASSIAN_API_TOKEN
//
// Commands emit compact, agent-readable JSON by default. Use `request` for raw API output.
//
// Commands:
//   me
//   projects [query]
//   issue <key> [fields]
//   comments <key>
//   search <jql> [fieldsCsv] [maxResults]
//   transitions <key>
//   transition <key> <transitionId>
//   add-comment <key> <plainText>
//   edit <key>              # reads Jira JSON payload from stdin
//   request <method> <path> [jsonBody]

import { execFileSync } from "node:child_process";
import { stdin } from "node:process";

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
  const baseUrl = firstEnv(["JIRA_BASE_URL", "ATLASSIAN_SITE_URL"])
    ?? firstKeychain(["JIRA_BASE_URL", "ATLASSIAN_SITE_URL"], [process.env.USER || ""]);
  const email = firstEnv(["JIRA_EMAIL", "ATLASSIAN_EMAIL"])
    ?? firstKeychain(["JIRA_EMAIL", "ATLASSIAN_EMAIL"], [process.env.USER || ""]);
  const token = firstEnv(["JIRA_API_TOKEN", "ATLASSIAN_API_TOKEN"])
    ?? firstKeychain(["JIRA_API_TOKEN", "ATLASSIAN_API_TOKEN"], [email || "", process.env.USER || ""]);

  const missing = [];
  if (!baseUrl) missing.push("JIRA_BASE_URL/ATLASSIAN_SITE_URL");
  if (!email) missing.push("JIRA_EMAIL/ATLASSIAN_EMAIL");
  if (!token) missing.push("JIRA_API_TOKEN/ATLASSIAN_API_TOKEN");
  if (missing.length) {
    throw new Error(`Missing Jira credentials: ${missing.join(", ")}. Set env vars or store them in macOS Keychain.`);
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), email, token };
}

const config = loadConfig();

function authHeader() {
  return `Basic ${Buffer.from(`${config.email}:${config.token}`).toString("base64")}`;
}

function jiraUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${config.baseUrl}${normalized}`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid JSON: ${message}`);
  }
}

async function request(method, path, body) {
  const init = {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(jiraUrl(path), init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${res.statusText}: ${text}`);
  }
  return text ? parseJson(text, "response") : null;
}

function adfText(text) {
  const paragraphs = String(text).split(/\n{2,}/).map((paragraph) => {
    const lines = paragraph.split("\n");
    const content = [];
    lines.forEach((line, index) => {
      if (line) content.push({ type: "text", text: line });
      if (index < lines.length - 1) content.push({ type: "hardBreak" });
    });
    return { type: "paragraph", content: content.length ? content : [{ type: "text", text: " " }] };
  });
  return { type: "doc", version: 1, content: paragraphs };
}

function adfToText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const children = Array.isArray(node.content) ? node.content.map(adfToText).join("") : "";
  if (["paragraph", "heading", "listItem"].includes(node.type)) return `${children}\n`;
  if (node.type === "bulletList" || node.type === "orderedList") return `${children}\n`;
  return children;
}

function compactUser(user) {
  if (!user) return null;
  return {
    accountId: user.accountId,
    displayName: user.displayName,
    emailAddress: user.emailAddress,
  };
}

function compactStatus(status) {
  if (!status) return null;
  return {
    id: status.id,
    name: status.name,
    category: status.statusCategory?.name,
  };
}

function compactIssue(issue) {
  const fields = issue.fields || {};
  return {
    key: issue.key,
    url: `${config.baseUrl}/browse/${issue.key}`,
    summary: fields.summary,
    type: fields.issuetype?.name,
    status: compactStatus(fields.status),
    assignee: compactUser(fields.assignee),
    reporter: compactUser(fields.reporter),
    priority: fields.priority?.name,
    labels: fields.labels || [],
    created: fields.created,
    updated: fields.updated,
  };
}

function compactIssueDetails(issue) {
  const fields = issue.fields || {};
  return {
    ...compactIssue(issue),
    descriptionText: adfToText(fields.description).trim(),
    links: (fields.issuelinks || []).map((link) => {
      if (link.inwardIssue) {
        return {
          relationship: link.type?.inward,
          key: link.inwardIssue.key,
          summary: link.inwardIssue.fields?.summary,
          status: compactStatus(link.inwardIssue.fields?.status),
        };
      }
      if (link.outwardIssue) {
        return {
          relationship: link.type?.outward,
          key: link.outwardIssue.key,
          summary: link.outwardIssue.fields?.summary,
          status: compactStatus(link.outwardIssue.fields?.status),
        };
      }
      return null;
    }).filter(Boolean),
    commentCount: fields.comment?.total,
  };
}

function compactComment(comment) {
  return {
    id: comment.id,
    author: compactUser(comment.author),
    created: comment.created,
    updated: comment.updated,
    bodyText: adfToText(comment.body).trim(),
  };
}

function compactProject(project) {
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    type: project.projectTypeKey,
    category: project.projectCategory?.name,
  };
}

function emit(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

async function search(jql, fieldsCsv, maxResultsRaw) {
  const maxResults = Number.parseInt(maxResultsRaw || "50", 10);
  if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error("maxResults must be a positive integer");

  const defaultFields = "summary,status,assignee,reporter,issuetype,priority,labels,created,updated";
  const fields = (fieldsCsv || defaultFields).split(",").map((field) => field.trim()).filter(Boolean);
  const issues = [];
  let nextPageToken = undefined;
  do {
    const body = { jql, fields, maxResults: Math.min(maxResults - issues.length, 100) };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = await request("POST", "/rest/api/3/search/jql", body);
    if (Array.isArray(page?.issues)) issues.push(...page.issues);
    nextPageToken = page?.nextPageToken;
  } while (nextPageToken && issues.length < maxResults);

  return { issues: issues.map(compactIssue), totalReturned: issues.length, hasMore: Boolean(nextPageToken), nextPageToken: nextPageToken || null };
}

async function projects(query) {
  const url = new URL(jiraUrl("/rest/api/3/project/search"));
  url.searchParams.set("maxResults", "100");
  if (query) url.searchParams.set("query", query);
  const body = await request("GET", url.toString());
  return {
    projects: Array.isArray(body?.values) ? body.values.map(compactProject) : [],
    total: body?.total,
    hasMore: Boolean(body?.isLast === false),
  };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "me":
      return emit(compactUser(await request("GET", "/rest/api/3/myself")));
    case "projects": {
      const [query] = args;
      return emit(await projects(query));
    }
    case "issue": {
      const [key, fieldsRaw] = args;
      if (!key) throw new Error("usage: issue <key> [fieldsCsv]");
      const fields = fieldsRaw || "summary,status,assignee,reporter,issuetype,priority,labels,description,issuelinks,comment,created,updated";
      const url = new URL(jiraUrl(`/rest/api/3/issue/${encodeURIComponent(key)}`));
      url.searchParams.set("fields", fields);
      return emit(compactIssueDetails(await request("GET", url.toString())));
    }
    case "comments": {
      const [key] = args;
      if (!key) throw new Error("usage: comments <key>");
      const body = await request("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`);
      return emit({ comments: (body.comments || []).map(compactComment), total: body.total });
    }
    case "search": {
      const [jql, fieldsCsv, maxResults] = args;
      if (!jql) throw new Error("usage: search <jql> [fieldsCsv] [maxResults]");
      return emit(await search(jql, fieldsCsv, maxResults));
    }
    case "transitions": {
      const [key] = args;
      if (!key) throw new Error("usage: transitions <key>");
      const body = await request("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
      return emit({ transitions: (body.transitions || []).map((t) => ({ id: t.id, name: t.name, to: compactStatus(t.to) })) });
    }
    case "transition": {
      const [key, transitionId] = args;
      if (!key || !transitionId) throw new Error("usage: transition <key> <transitionId>");
      await request("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: transitionId } });
      return emit({ ok: true, key, transitionId });
    }
    case "add-comment": {
      const [key, ...textParts] = args;
      const text = textParts.join(" ");
      if (!key || !text) throw new Error("usage: add-comment <key> <plainText>");
      return emit(compactComment(await request("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: adfText(text) })));
    }
    case "edit": {
      const [key] = args;
      if (!key) throw new Error("usage: edit <key> < stdin-json-payload");
      const raw = await readStdin();
      if (!raw) throw new Error("edit requires JSON payload on stdin");
      await request("PUT", `/rest/api/3/issue/${encodeURIComponent(key)}`, parseJson(raw, "stdin"));
      return emit({ ok: true, key });
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
