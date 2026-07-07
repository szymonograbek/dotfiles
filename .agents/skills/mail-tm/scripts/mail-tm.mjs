#!/usr/bin/env node
// Thin mail.tm REST API client for the mail-tm skill.
// Commands emit compact JSON. Use `request` for raw API output.

import { randomBytes } from "node:crypto";

const baseUrl = (process.env.MAIL_TM_BASE_URL || "https://api.mail.tm").replace(/\/$/, "");
const defaultPassword = process.env.MAIL_TM_PASSWORD || null;

function usage() {
  console.error(`Usage:
  mail-tm.mjs domains
  mail-tm.mjs create [localPart] [password]
  mail-tm.mjs token <address> <password>
  mail-tm.mjs inbox <address> <password> [limit]
  mail-tm.mjs poll <address> <password> [timeoutSeconds] [intervalSeconds]
  mail-tm.mjs message <address> <password> <messageId>
  mail-tm.mjs delete-message <address> <password> <messageId>
  mail-tm.mjs request <METHOD> <PATH> [json]
`);
  process.exit(2);
}

function fail(message, detail) {
  const payload = detail === undefined ? { error: message } : { error: message, detail };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function generatedLocalPart() {
  return `pi-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function generatedPassword() {
  return defaultPassword || `Pi-${randomBytes(12).toString("base64url")}-1a`;
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    fail(`HTTP ${response.status} ${response.statusText}`, body);
  }

  return body;
}

async function tokenFor(address, password) {
  const result = await api("/token", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });

  if (!result || typeof result.token !== "string") {
    fail("Token response did not include a token", result);
  }

  return result.token;
}

async function authenticatedApi(address, password, path, options = {}) {
  const token = await tokenFor(address, password);
  return api(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

function required(value, name) {
  if (!value) fail(`Missing required argument: ${name}`);
  return value;
}

function collection(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.["hydra:member"])) return result["hydra:member"];
  return [];
}

async function domains() {
  const result = await api("/domains");
  printJson({ domains: collection(result) });
}

async function create(localPart, passwordArg) {
  const domainResult = await api("/domains");
  const domains = collection(domainResult);
  const activeDomain = domains.find((domain) => domain?.isActive && typeof domain.domain === "string");

  if (!activeDomain) fail("No active mail.tm domains found", domainResult);

  const password = passwordArg || generatedPassword();
  const address = `${localPart || generatedLocalPart()}@${activeDomain.domain}`;
  const account = await api("/accounts", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });
  const token = await tokenFor(address, password);

  printJson({ address, password, token, account });
}

async function inbox(address, password, limitArg) {
  const result = await authenticatedApi(address, password, "/messages");
  const messages = collection(result);
  const limit = Number.parseInt(limitArg || String(messages.length), 10);

  printJson({ address, count: messages.length, messages: messages.slice(0, limit) });
}

async function poll(address, password, timeoutArg, intervalArg) {
  const timeoutMs = Number.parseInt(timeoutArg || "60", 10) * 1000;
  const intervalMs = Number.parseInt(intervalArg || "3", 10) * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const result = await authenticatedApi(address, password, "/messages");
    const messages = collection(result);

    if (messages.length > 0) {
      printJson({ address, count: messages.length, messages });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  printJson({ address, count: 0, messages: [], timedOut: true });
}

async function message(address, password, messageId) {
  const result = await authenticatedApi(address, password, `/messages/${encodeURIComponent(messageId)}`);
  printJson(result);
}

async function deleteMessage(address, password, messageId) {
  const result = await authenticatedApi(address, password, `/messages/${encodeURIComponent(messageId)}`, {
    method: "DELETE",
  });
  printJson({ deleted: true, result });
}

async function rawRequest(method, path, rawJson) {
  let body;
  if (rawJson !== undefined) {
    try {
      body = JSON.stringify(JSON.parse(rawJson));
    } catch (error) {
      fail("Invalid JSON body", error instanceof Error ? error.message : String(error));
    }
  }

  const result = await api(path, { method, body });
  printJson(result);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") usage();

  if (command === "domains") return domains();
  if (command === "create") return create(args[0], args[1]);
  if (command === "token") return printJson({ token: await tokenFor(required(args[0], "address"), required(args[1], "password")) });
  if (command === "inbox") return inbox(required(args[0], "address"), required(args[1], "password"), args[2]);
  if (command === "poll") return poll(required(args[0], "address"), required(args[1], "password"), args[2], args[3]);
  if (command === "message") return message(required(args[0], "address"), required(args[1], "password"), required(args[2], "messageId"));
  if (command === "delete-message") return deleteMessage(required(args[0], "address"), required(args[1], "password"), required(args[2], "messageId"));
  if (command === "request") return rawRequest(required(args[0], "method"), required(args[1], "path"), args[2]);

  fail(`Unknown command: ${command}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
