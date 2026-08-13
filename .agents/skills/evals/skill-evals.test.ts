import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import type { SkillEvaluation, TrialResult } from "./src/types.js";

function isSkillEvaluation(value: unknown): value is SkillEvaluation {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value) || typeof value.name !== "string") return false;
  if (!("runTrial" in value) || typeof value.runTrial !== "function") return false;
  if (!("weights" in value) || typeof value.weights !== "object" || value.weights === null) return false;
  return "deterministic" in value.weights
    && typeof value.weights.deterministic === "number"
    && "semantic" in value.weights
    && typeof value.weights.semantic === "number";
}

const sharedEvalsDir = dirname(fileURLToPath(import.meta.url));
const skillsDir = dirname(sharedEvalsDir);
const skillName = process.env.EVAL_SKILL;
if (!skillName || !/^[a-z0-9-]+$/.test(skillName)) {
  throw new Error("Set EVAL_SKILL to a skill directory name, for example figma-to-md");
}

const skillDir = join(skillsDir, skillName);
const skillEvalsDir = join(skillDir, "evals");
const loadedModule: unknown = await import(pathToFileURL(join(skillEvalsDir, "eval.ts")).href);
if (typeof loadedModule !== "object" || loadedModule === null || !("evaluation" in loadedModule) || !isSkillEvaluation(loadedModule.evaluation)) {
  throw new Error(`${skillName}/evals/eval.ts must export a valid evaluation`);
}
const evaluation = loadedModule.evaluation;

const configuredTrials = Number.parseInt(process.env.EVAL_TRIALS ?? "1", 10);
if (!Number.isSafeInteger(configuredTrials) || configuredTrials < 1) {
  throw new Error("EVAL_TRIALS must be a positive integer");
}

const baseline: unknown = JSON.parse(await readFile(join(skillEvalsDir, "baseline.json"), "utf8"));
if (typeof baseline !== "object" || baseline === null || !("minimumScore" in baseline) || typeof baseline.minimumScore !== "number") {
  throw new Error(`${skillName}/evals/baseline.json must contain a numeric minimumScore`);
}
const minimumScore = baseline.minimumScore;
const runId = new Date().toISOString().replaceAll(":", "-");
const resultDir = process.env.EVAL_RESULTS_DIR ?? join(tmpdir(), "skill-evals", skillName, runId);
const results: TrialResult[] = [];

await mkdir(resultDir, { recursive: true });

describe(evaluation.name, () => {
  for (let trial = 1; trial <= configuredTrials; trial += 1) {
    test(`trial ${trial}`, async () => {
      const result = await evaluation.runTrial({ trial, resultDir, skillDir, skillEvalsDir });
      results.push(result);

      expect(result.deterministic.checks.filter((check) => !check.passed), result.deterministic.details).toEqual([]);
      for (const gate of result.qualityGates ?? []) {
        expect(gate.score, gate.feedback).toBeGreaterThanOrEqual(gate.minimum);
      }
      expect(result.score, result.semantic.feedback).toBeGreaterThanOrEqual(minimumScore);
    });
  }
});

afterAll(async () => {
  const averageScore = results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.score, 0) / results.length;
  const summary = {
    skill: evaluation.name,
    model: "openai-codex/gpt-5.6-terra",
    weights: evaluation.weights,
    minimumScore,
    trials: results.length,
    averageScore,
    results: results.map(({ trial, score, deterministic, semantic, qualityGates, workspace }) => ({
      trial,
      score,
      deterministicScore: deterministic.score,
      semanticScore: semantic.score,
      semanticFeedback: semantic.feedback,
      qualityGates,
      workspace,
    })),
  };
  await writeFile(join(resultDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nEval results: ${resultDir}`);
  console.log(`Average score: ${averageScore.toFixed(3)} (${results.length} trial${results.length === 1 ? "" : "s"})`);
});
