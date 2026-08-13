import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { runPi } from "../../evals/src/pi.js";
import { gradeSemantically } from "../../evals/src/semantic.js";
import type { SkillEvaluation, TrialOptions, TrialResult } from "../../evals/src/types.js";
import { gradeDeterministically } from "./deterministic.js";

const weights = { deterministic: 0.4, semantic: 0.6 };

async function runTrial(options: TrialOptions): Promise<TrialResult> {
  const trialDir = join(options.resultDir, `trial-${String(options.trial).padStart(2, "0")}`);
  const workspace = join(trialDir, "workspace");
  const fixtureDir = join(options.skillEvalsDir, "fixtures");
  const skillsDir = join(workspace, ".agents", "skills");
  const copiedSkillPath = join(skillsDir, "ready-to-review", "SKILL.md");

  await mkdir(join(skillsDir, "ready-to-review"), { recursive: true });
  await cp(join(fixtureDir, "workspace"), workspace, { recursive: true });
  await cp(join(options.skillDir, "SKILL.md"), copiedSkillPath);
  for (const dependency of ["jira-api", "pull-request", "jj"]) {
    await mkdir(join(skillsDir, dependency), { recursive: true });
    await cp(join(options.skillDir, "..", dependency, "SKILL.md"), join(skillsDir, dependency, "SKILL.md"));
  }
  await mkdir(join(skillsDir, "jira-api", "scripts"), { recursive: true });
  await cp(
    join(fixtureDir, "dependency-skills", "jira-api", "scripts", "jira.mjs"),
    join(skillsDir, "jira-api", "scripts", "jira.mjs"),
  );
  await Promise.all(["jj", "git", "gh"].map((command) => chmod(join(fixtureDir, "bin", command), 0o755)));

  const instruction = await readFile(join(options.skillEvalsDir, "instructions", "stacked-jj.md"), "utf8");
  const originalPath = process.env.PATH;
  process.env.PATH = `${join(fixtureDir, "bin")}${delimiter}${originalPath ?? ""}`;
  let agentRun;
  try {
    agentRun = await runPi({
      cwd: workspace,
      prompt: instruction,
      trajectoryPath: join(workspace, ".eval", "pi-events.jsonl"),
      skillPath: copiedSkillPath,
      tools: ["read", "bash"],
    });
  } finally {
    process.env.PATH = originalPath;
  }
  await writeFile(join(trialDir, "agent-response.md"), agentRun.response);
  if (agentRun.error) throw new Error(`Evaluated agent failed: ${agentRun.error}`);

  const deterministic = await gradeDeterministically(workspace);
  const state = await readFile(join(workspace, ".eval", "state.json"), "utf8");
  const candidatePath = join(trialDir, "candidate.md");
  await writeFile(candidatePath, `# Agent response\n\n${agentRun.response}\n\n# Resulting fixture state\n\n\`\`\`json\n${state}\n\`\`\`\n`);
  const semantic = await gradeSemantically({
    cwd: workspace,
    rubricPath: join(options.skillEvalsDir, "rubrics", "stacked-jj.md"),
    artifactPath: candidatePath,
    trajectoryPath: join(trialDir, "judge-events.jsonl"),
  });
  const score = deterministic.score * weights.deterministic + semantic.score * weights.semantic;
  const result: TrialResult = { trial: options.trial, deterministic, semantic, score, workspace };
  await writeFile(join(trialDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export const evaluation = {
  name: "ready-to-review",
  weights,
  runTrial,
} satisfies SkillEvaluation;
