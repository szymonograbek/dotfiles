import { readFile } from "node:fs/promises";
import { runPi } from "./pi.js";
import type { SemanticResult } from "./types.js";

export type SemanticGradeOptions = {
  cwd: string;
  rubricPath: string;
  artifactPath: string;
  trajectoryPath: string;
};

function parseResult(response: string): SemanticResult {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Semantic judge returned no JSON: ${response}`);

  const value: unknown = JSON.parse(match[0]);
  if (typeof value !== "object" || value === null || !("score" in value) || !("feedback" in value)) {
    throw new Error(`Semantic judge returned an invalid result: ${response}`);
  }

  const score = value.score;
  const feedback = value.feedback;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1 || typeof feedback !== "string") {
    throw new Error(`Semantic judge returned an invalid score or feedback: ${response}`);
  }

  return { score, feedback };
}

export async function gradeSemantically(options: SemanticGradeOptions): Promise<SemanticResult> {
  const rubric = await readFile(options.rubricPath, "utf8");
  const artifact = await readFile(options.artifactPath, "utf8");
  const prompt = [
    "Apply the rubric to the candidate artifact.",
    "Return only JSON with this shape: {\"score\": 0.0, \"feedback\": \"concise evidence-based explanation\"}.",
    "Score must be between 0 and 1.",
    "",
    "# Rubric",
    rubric,
    "",
    "# Candidate artifact",
    artifact,
  ].join("\n");

  const run = await runPi({
    cwd: options.cwd,
    prompt,
    trajectoryPath: options.trajectoryPath,
    tools: [],
    systemPrompt: "You are a strict evaluator. Judge only from the supplied rubric and artifact. Output only valid JSON.",
  });
  if (run.error) throw new Error(`Semantic judge failed: ${run.error}`);

  return parseResult(run.response);
}
