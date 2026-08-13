import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readTextOr } from "../../evals/src/files.js";
import { formatInterviewTranscript, runSimulatedInterview } from "../../evals/src/interview.js";
import { createPiAgent } from "../../evals/src/pi.js";
import { gradeSemantically } from "../../evals/src/semantic.js";
import type { SkillEvaluation, TrialOptions, TrialResult } from "../../evals/src/types.js";
import { prepareTrialWorkspace } from "../../evals/src/workspace.js";
import { gradeDeterministically } from "./deterministic.js";

const weights = { deterministic: 0.2, semantic: 0.8 };

async function runTrial(options: TrialOptions): Promise<TrialResult> {
  const { trialDir, workspace, fixtureDir, copiedSkillPath } = await prepareTrialWorkspace(options, "specs");
  const specPath = join(workspace, "spec.md");

  await cp(join(fixtureDir, "workspace"), workspace, { recursive: true });

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

  const transcript = formatInterviewTranscript(interview, {
    interviewer: "interviewer",
    stakeholder: "stakeholder",
  });
  await writeFile(join(trialDir, "transcript.md"), `${transcript}\n`);

  const spec = await readTextOr(specPath, "(spec.md was not created)");
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
