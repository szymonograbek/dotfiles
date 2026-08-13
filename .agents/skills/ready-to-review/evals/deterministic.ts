import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resultFromChecks } from "../../evals/src/deterministic.js";
import type { DeterministicResult, EvalCheck } from "../../evals/src/types.js";

type Change = { id: string; description: string; files: string[] };
type PullRequest = { url: string; baseRefName: string; headRefName: string; title: string; body: string; assignees: string[] };
type FixtureState = {
  bookmark: string;
  baseBookmark: string;
  changes: Change[];
  pushed: boolean;
  pr: PullRequest | null;
  jiraReads: number;
  jiraRawReads: number;
  jiraDescription: string;
  calls: string[];
};

export async function gradeDeterministically(workspace: string): Promise<DeterministicResult> {
  const state: FixtureState = JSON.parse(await readFile(join(workspace, ".eval", "state.json"), "utf8"));
  const events = await readFile(join(workspace, ".eval", "pi-events.jsonl"), "utf8");
  const checks: EvalCheck[] = [];
  const check = (name: string, passed: boolean, message: string) => checks.push({ name, passed, message });
  const pr = state.pr;

  check("jj-only", !state.calls.some((call) => call.startsWith("git ")), "No git command was used in the jj repository");
  check("all-change-descriptions", state.changes.every((change) => change.description.includes("ABC-314")), "Every change in the review stack has a Jira-keyed description");
  check(
    "stack-inspected",
    state.calls.some((call) => call.startsWith("jj log") && call.includes("feat/invite-onboarding.."))
      && state.calls.some((call) => call.startsWith("jj diff") && call.includes("feat/invite-onboarding")
        && (call.includes("@") || call.includes("feat/ABC-314-team-members"))),
    "The complete stacked change list and diff were inspected",
  );
  check("pushed", state.pushed, "The feature bookmark was pushed");
  check("pr-created", pr !== null, "A pull request was created");
  check("correct-pr-base", pr?.baseRefName === "feat/invite-onboarding", "The PR targets its actual stacked parent rather than the repository default");
  check("correct-pr-head", pr?.headRefName === "feat/ABC-314-team-members", "The intended feature bookmark is the PR head");
  check("pr-complete-scope", pr !== null && pr.title.includes("ABC-314") && /invitation/i.test(pr.body) && /member/i.test(pr.body), "The PR title and body represent the complete stack, not only the top change");
  check("pr-template", pr !== null && ["## What", "## Why", "## How"].every((heading) => pr.body.includes(heading)), "The PR uses the required reviewer template");
  check("pr-assigned", pr?.assignees.includes("orbit-dev") === true, "The current GitHub user is assigned");
  check("jira-read-write-verify", state.jiraReads >= 2 && state.jiraRawReads >= 1 && state.jiraDescription.includes("What changed") && state.jiraDescription.includes("Acceptance criteria") && state.jiraDescription.includes("QA testing steps"), "Jira was read, safely updated with QA-ready sections, and read back");
  check("skills-inspected", ["ready-to-review/SKILL.md", "jira-api/SKILL.md", "pull-request/SKILL.md", "jj/SKILL.md"].every((name) => events.includes(name)), "The handoff and required dependency skills were inspected");

  return resultFromChecks(checks);
}
