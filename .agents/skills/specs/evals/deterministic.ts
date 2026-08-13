import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { resultFromChecks } from "../../evals/src/deterministic.js";
import { readTextOr } from "../../evals/src/files.js";
import type { SimulatedInterviewResult } from "../../evals/src/interview.js";
import type { DeterministicResult, EvalCheck } from "../../evals/src/types.js";

type GradeOptions = {
  workspace: string;
  interview: SimulatedInterviewResult;
};

export async function gradeDeterministically(options: GradeOptions): Promise<DeterministicResult> {
  const checks: EvalCheck[] = [];
  const check = (name: string, passed: boolean, message: string) => {
    checks.push({ name, passed, message });
  };

  check("interview-completed", options.interview.completed, "Interview completed within the turn limit");
  check("explicit-confirmation", options.interview.confirmed, "Stakeholder explicitly confirmed shared understanding");
  check("write-after-confirmation", !options.interview.specCreatedBeforeConfirmation, "spec.md was not created before confirmation");

  const spec = await readTextOr(join(options.workspace, "spec.md"));
  check("spec-created", spec.length > 0, "A non-empty spec.md was created");

  const requiredHeadings = [
    "## At a glance",
    "## Why this matters",
    "## Scope and non-goals",
    "## Users, permissions, and needs",
    "## Story map",
    "## Detailed stories and scenarios",
    "## Cross-cutting requirements",
    "## Constraints, assumptions, and risks",
    "## Open questions",
  ];
  check("required-structure", requiredHeadings.every((heading) => spec.includes(heading)), "spec.md contains every required top-level section");
  check("agreed-status", spec.includes("**Status:** Agreed"), "The confirmed specification is marked Agreed");

  const entries = await readdir(options.workspace, { withFileTypes: true });
  const allowedTopLevel = new Set([".agents", ".eval", "CONTEXT.md", "README.md", "spec.md"]);
  const unexpectedEntries = entries.map((entry) => entry.name).filter((name) => !allowedTopLevel.has(name));
  check("no-implementation-or-extra-artifacts", unexpectedEntries.length === 0, `Unexpected workspace entries: ${unexpectedEntries.join(", ") || "none"}`);

  const events = await readTextOr(join(options.workspace, ".eval", "subject-events.jsonl"));
  const readmeIndex = events.indexOf("README.md");
  const contextIndex = events.indexOf("CONTEXT.md");
  const writeIndex = events.indexOf('"toolName":"write"');
  check("context-inspected", readmeIndex >= 0 && contextIndex >= 0, "The specs agent inspected README.md and CONTEXT.md");
  check(
    "context-before-write",
    writeIndex < 0 || (readmeIndex >= 0 && contextIndex >= 0 && readmeIndex < writeIndex && contextIndex < writeIndex),
    "Product evidence was inspected before spec.md was written",
  );
  check("skill-loaded", events.includes("specs/SKILL.md"), "Pi loaded the specs skill");

  return resultFromChecks(checks);
}
