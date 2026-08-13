import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTextFixtureTool } from "../../evals/src/fixture-tool.js";
import { runPiAndRecord } from "../../evals/src/pi.js";
import { gradeSemantically } from "../../evals/src/semantic.js";
import type { SkillEvaluation, TrialOptions, TrialResult } from "../../evals/src/types.js";
import { prepareTrialWorkspace } from "../../evals/src/workspace.js";
import { gradeDeterministically } from "./deterministic.js";

const weights = { deterministic: 0.3, semantic: 0.7 };

async function runTrial(options: TrialOptions): Promise<TrialResult> {
  const { trialDir, workspace, fixtureDir, copiedSkillPath } = await prepareTrialWorkspace(options, "figma-to-md");

  await cp(join(fixtureDir, "app"), workspace, { recursive: true });
  await cp(join(fixtureDir, "figma-design-context.md"), join(workspace, ".eval", "figma-design-context.md"));

  const figmaFixture = createTextFixtureTool({
    name: "figma_get_design_context",
    label: "Figma: Get Design Context",
    description: "Inspect the selected Figma frame, including hierarchy, exact copy, visual properties, and source asset identifiers.",
    fixturePath: join(fixtureDir, "figma-design-context.md"),
    expectedArguments: { fileKey: "AbC123Fixture", nodeId: "42:100" },
  });
  const instruction = await readFile(join(options.skillEvalsDir, "instructions", "basic-screen.md"), "utf8");
  await runPiAndRecord({
    cwd: workspace,
    prompt: instruction,
    trajectoryPath: join(workspace, ".eval", "pi-events.jsonl"),
    responsePath: join(trialDir, "agent-response.md"),
    skillPath: copiedSkillPath,
    inlineExtensions: [figmaFixture],
    tools: ["read", "bash", "edit", "write", "figma_get_design_context"],
  });

  const deterministic = await gradeDeterministically(workspace);
  const semantic = await gradeSemantically({
    cwd: workspace,
    rubricPath: join(options.skillEvalsDir, "rubrics", "basic-screen.md"),
    artifactPath: join(workspace, "designs", "booking-confirmed.md"),
    trajectoryPath: join(trialDir, "judge-events.jsonl"),
  });
  const score = deterministic.score * weights.deterministic + semantic.score * weights.semantic;
  const result: TrialResult = { trial: options.trial, deterministic, semantic, score, workspace };
  await writeFile(join(trialDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

  return result;
}

export const evaluation = {
  name: "figma-to-md",
  weights,
  runTrial,
} satisfies SkillEvaluation;
