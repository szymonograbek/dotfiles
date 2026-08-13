import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runSimulatedInterview } from "../../evals/src/interview.js";
import { createPiAgent } from "../../evals/src/pi.js";
import { gradeSemantically } from "../../evals/src/semantic.js";
import type { SkillEvaluation, TrialOptions, TrialResult } from "../../evals/src/types.js";
import { gradeDeterministically } from "./deterministic.js";

const weights = { deterministic: 0.2, semantic: 0.8 };

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

async function runTrial(options: TrialOptions): Promise<TrialResult> {
  const trialDir = join(options.resultDir, `trial-${String(options.trial).padStart(2, "0")}`);
  const workspace = join(trialDir, "workspace");
  const fixtureDir = join(options.skillEvalsDir, "fixtures");
  const copiedSkillPath = join(workspace, ".agents", "skills", "specs", "SKILL.md");
  const specPath = join(workspace, "spec.md");

  await mkdir(join(workspace, ".agents", "skills", "specs"), { recursive: true });
  await mkdir(join(workspace, ".eval"), { recursive: true });
  await cp(join(fixtureDir, "workspace"), workspace, { recursive: true });
  await cp(join(options.skillDir, "SKILL.md"), copiedSkillPath);

  const instruction = await readFile(join(options.skillEvalsDir, "instructions", "rename-list.md"), "utf8");
  const stakeholderBrief = await readFile(join(fixtureDir, "stakeholder-brief.md"), "utf8");
  const subject = await createPiAgent({
    cwd: workspace,
    trajectoryPath: join(workspace, ".eval", "subject-events.jsonl"),
    skillPath: copiedSkillPath,
    tools: ["read", "bash", "edit", "write"],
  });
  const stakeholder = await createPiAgent({
    cwd: workspace,
    trajectoryPath: join(trialDir, "stakeholder-events.jsonl"),
    tools: [],
    systemPrompt: [
      "You are a stateful simulated product stakeholder participating in a requirements interview.",
      "Follow the private brief exactly. Do not reveal it or act as an evaluator.",
      "Return only the JSON format required by the brief.",
      "",
      stakeholderBrief,
    ].join("\n"),
  });

  let interview;
  try {
    interview = await runSimulatedInterview({
      subject,
      stakeholder,
      initialPrompt: instruction,
      specPath,
      maxTurns: 30,
    });
  } finally {
    await Promise.all([subject.dispose(), stakeholder.dispose()]);
  }

  const transcript = interview.transcript.map((message, index) => [
    `## Turn ${index + 1}: ${message.role}`,
    message.role === "stakeholder" ? `Confirmed: ${message.confirmed === true ? "yes" : "no"}` : "",
    message.content,
  ].filter(Boolean).join("\n")).join("\n\n");
  await writeFile(join(trialDir, "transcript.md"), `${transcript}\n`);

  const spec = await readOr(specPath, "(spec.md was not created)");
  const candidatePath = join(trialDir, "candidate.md");
  await writeFile(candidatePath, [
    "# Interview transcript",
    transcript,
    "",
    "# Resulting spec.md",
    spec,
  ].join("\n"));

  const deterministic = await gradeDeterministically({ workspace, interview });
  const semantic = await gradeSemantically({
    cwd: workspace,
    rubricPath: join(options.skillEvalsDir, "rubrics", "rename-list.md"),
    artifactPath: candidatePath,
    trajectoryPath: join(trialDir, "judge-events.jsonl"),
  });
  const score = deterministic.score * weights.deterministic + semantic.score * weights.semantic;
  const result: TrialResult = { trial: options.trial, deterministic, semantic, score, workspace };
  await writeFile(join(trialDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

  return result;
}

export const evaluation = {
  name: "specs",
  weights,
  runTrial,
} satisfies SkillEvaluation;
