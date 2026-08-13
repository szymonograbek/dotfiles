import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { resultFromChecks } from "../../evals/src/deterministic.js";
import { readTextOr } from "../../evals/src/files.js";
import type { SimulatedInterviewResult } from "../../evals/src/interview.js";
import type { DeterministicResult, EvalCheck } from "../../evals/src/types.js";

export type DeterministicScenario = {
  staticContract: readonly string[];
  requiredEvidence: readonly string[];
};

type GradeOptions = {
  workspace: string;
  interview: SimulatedInterviewResult;
  scenario: DeterministicScenario;
};

export async function gradeDeterministically(options: GradeOptions): Promise<DeterministicResult> {
  const checks: EvalCheck[] = [];
  const check = (name: string, passed: boolean, message: string) => checks.push({ name, passed, message });

  check("interview-completed", options.interview.completed, "Interview completed within the safety limit");
  check("explicit-confirmation", options.interview.confirmed, "Engineer explicitly confirmed shared understanding");
  check("write-after-confirmation", !options.interview.specCreatedBeforeConfirmation, "plan.md was not created before confirmation");

  const plan = await readTextOr(join(options.workspace, "plan.md"));
  check("plan-created", plan.length > 0, "A non-empty plan.md was created");
  const headings = [
    "## At a glance",
    "## Relevant context",
    "## Decisions",
    "## Proposed architecture and data flow",
    "## API, schema, and UI changes",
    "## Implementation steps",
    "## Testing and acceptance coverage",
    "## Rollout, rollback, observability, and risks",
    "## Open questions",
  ];
  check("required-plan-structure", headings.every((heading) => plan.includes(heading)), "plan.md uses every required section");
  check("agreed-status", plan.includes("**Status:** Agreed"), "The confirmed plan is marked Agreed");

  check(
    "static-contract-preserved",
    options.scenario.staticContract.every((fact) => plan.includes(fact)),
    "The plan preserves objective scenario types and implementation identifiers",
  );

  const events = await readTextOr(join(options.workspace, ".eval", "subject-events.jsonl"));
  check(
    "repository-evidence-inspected",
    options.scenario.requiredEvidence.every((path) => events.includes(path)),
    "The planner inspected the specification and relevant repository conventions",
  );
  check("skill-loaded", events.includes("specs-to-plan/SKILL.md"), "Pi loaded the specs-to-plan skill");

  const topLevel = await readdir(options.workspace, { withFileTypes: true });
  const allowed = new Set([".agents", ".eval", "src", "README.md", "package.json", "spec.md", "plan.md"]);
  const unexpected = topLevel.map((entry) => entry.name).filter((name) => !allowed.has(name));
  check("plan-only", unexpected.length === 0, `No implementation artifacts were created: ${unexpected.join(", ") || "none"}`);

  return resultFromChecks(checks);
}
