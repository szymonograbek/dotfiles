import { readFile } from "node:fs/promises";
import { runPi } from "../../evals/src/pi.js";
import type { SemanticResult } from "../../evals/src/types.js";

export type DesignSemanticResult = {
  semantic: SemanticResult;
  recommendationScore: number;
  recommendationFeedback: string;
  planScore: number;
  planFeedback: string;
};

type GradeOptions = {
  cwd: string;
  rubricPath: string;
  candidatePath: string;
  trajectoryPath: string;
};

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseResult(response: string): DesignSemanticResult {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Design judge returned no JSON: ${response}`);

  const value: unknown = JSON.parse(match[0]);
  if (typeof value !== "object" || value === null) throw new Error(`Design judge returned invalid JSON: ${response}`);
  if (!("recommendationScore" in value) || !("recommendationFeedback" in value)
    || !("planScore" in value) || !("planFeedback" in value) || !("overallScore" in value)) {
    throw new Error(`Design judge omitted required fields: ${response}`);
  }

  const recommendationScore = value.recommendationScore;
  const recommendationFeedback = value.recommendationFeedback;
  const planScore = value.planScore;
  const planFeedback = value.planFeedback;
  const overallScore = value.overallScore;
  if (!validScore(recommendationScore) || typeof recommendationFeedback !== "string"
    || !validScore(planScore) || typeof planFeedback !== "string" || !validScore(overallScore)) {
    throw new Error(`Design judge returned invalid fields: ${response}`);
  }

  const calculatedOverall = (recommendationScore + planScore) / 2;
  if (Math.abs(overallScore - calculatedOverall) > 0.01) {
    throw new Error(`Design judge overallScore ${overallScore} does not match ${calculatedOverall}`);
  }

  return {
    semantic: {
      score: calculatedOverall,
      feedback: `Recommendations: ${recommendationFeedback} Final plan: ${planFeedback}`,
    },
    recommendationScore,
    recommendationFeedback,
    planScore,
    planFeedback,
  };
}

export async function gradeDesign(options: GradeOptions): Promise<DesignSemanticResult> {
  const rubric = await readFile(options.rubricPath, "utf8");
  const candidate = await readFile(options.candidatePath, "utf8");
  const prompt = [
    "Apply the rubric to the interview transcript and final plan.",
    "Return only JSON with this exact shape:",
    '{"recommendationScore":0.0,"recommendationFeedback":"...","planScore":0.0,"planFeedback":"...","overallScore":0.0}',
    "All scores are between 0 and 1. overallScore is the arithmetic mean of recommendationScore and planScore.",
    "",
    "# Rubric",
    rubric,
    "",
    "# Candidate",
    candidate,
  ].join("\n");

  const run = await runPi({
    cwd: options.cwd,
    prompt,
    trajectoryPath: options.trajectoryPath,
    tools: [],
    systemPrompt: "You are a strict software architecture evaluator. Score first recommendations before correction separately from the final plan. Output only valid JSON.",
  });
  if (run.error) throw new Error(`Design judge failed: ${run.error}`);

  return parseResult(run.response);
}
