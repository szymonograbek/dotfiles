import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { resultFromChecks } from "../../evals/src/deterministic.js";
import { readTextOr } from "../../evals/src/files.js";
import type { DeterministicResult, EvalCheck } from "../../evals/src/types.js";

export async function gradeDeterministically(workspace: string): Promise<DeterministicResult> {
  const checks: EvalCheck[] = [];
  const check = (name: string, passed: boolean, message: string) => checks.push({ name, passed, message });
  const ticketDir = join(workspace, "tickets");
  const entries = await readdir(ticketDir, { withFileTypes: true }).catch(() => []);
  const ticketFiles = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
    .map((entry) => entry.name)
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  const expectedFiles = ticketFiles.map((_, index) => `${index + 1}.md`);
  check("consecutive-ticket-files", ticketFiles.length >= 3 && ticketFiles.every((file, index) => file === expectedFiles[index]), "At least three consecutively numbered ticket files exist");

  const tickets = await Promise.all(ticketFiles.map(async (file) => ({
    file,
    content: await readTextOr(join(ticketDir, file)),
  })));
  const requiredHeadings = [
    "## Goal", "## Context", "## Commit guidance", "## Scope", "### In scope", "### Out of scope",
    "## Implementation notes", "## Acceptance criteria", "## Verification", "## Dependencies", "## Risks and follow-ups",
  ];
  check("required-ticket-format", tickets.length > 0 && tickets.every(({ content }) => requiredHeadings.every((heading) => content.includes(heading))), "Every ticket uses the required format");
  check(
    "stacked-commit-guidance",
    tickets.length > 0
      && tickets.every(({ content }) => content.includes("separate commit"))
      && tickets.slice(1).every(({ content }) => content.includes("stacked")),
    "Every ticket requires a separate commit and each dependent ticket is stacked",
  );

  const combined = tickets.map(({ file, content }) => `# ${file}\n${content}`).join("\n\n");
  const contractFacts = [
    "/v1/teams/{teamId}/members", "nextCursor", "pageParam", "teamQueryKeys.members", "displayName", "avatarUrl",
    "owner", "admin", "member", "unexpected", "first occurrence", "No members yet", "You're offline",
    "You don't have access to this team", "This team is no longer available", "Couldn't load members",
    "Couldn't refresh members", "Couldn't load more members", "team_members_opened", "team_members_page_loaded",
  ];
  check("static-plan-decisions", contractFacts.every((fact) => combined.includes(fact)), "The ticket set preserves objective contract and behavior facts");

  const teamScreenTickets = tickets.filter(({ content }) => content.includes("TeamScreen"));
  check("teamscreen-ticket-present", teamScreenTickets.length > 0, "At least one ticket explicitly owns TeamScreen");

  const finalTicket = tickets.at(-1)?.content ?? "";
  check(
    "final-verification-ticket",
    /post-implementation|final verification|finished feature/i.test(finalTicket)
      && finalTicket.includes("typecheck")
      && finalTicket.includes("lint")
      && finalTicket.includes("rn-iso")
      && finalTicket.includes("Argent"),
    "The last ticket is separate finished-feature verification with required checks",
  );

  const events = await readTextOr(join(workspace, ".eval", "pi-events.jsonl"));
  check("plan-inspected", events.includes("plan.md"), "Pi inspected plan.md");
  check(
    "code-context-inspected",
    events.includes("src/api/request.ts") && events.includes("teamQueryKeys.ts") && events.includes("TeamSettingsScreen.tsx"),
    "Pi inspected relevant API, query-key, and screen context",
  );
  check("skill-loaded", events.includes("plan-to-tickets/SKILL.md"), "Pi loaded the plan-to-tickets skill");

  const topLevel = await readdir(workspace, { withFileTypes: true });
  const allowed = new Set([".agents", ".eval", "app", "src", "README.md", "plan.md", "tickets"]);
  const unexpected = topLevel.map((entry) => basename(entry.name)).filter((name) => !allowed.has(name));
  check("local-tickets-only", unexpected.length === 0, `No implementation or remote-ticket artifacts were created: ${unexpected.join(", ") || "none"}`);

  return resultFromChecks(checks);
}
