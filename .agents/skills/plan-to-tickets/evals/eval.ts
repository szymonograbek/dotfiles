import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPi } from "../../evals/src/pi.js";
import { gradeSemantically } from "../../evals/src/semantic.js";
import type { SkillEvaluation, TrialOptions, TrialResult } from "../../evals/src/types.js";
import { gradeDeterministically } from "./deterministic.js";

const weights = { deterministic: 0.3, semantic: 0.7 };

async function runTrial(options: TrialOptions): Promise<TrialResult> {
  const trialDir = join(options.resultDir, `trial-${String(options.trial).padStart(2, "0")}`);
  const workspace = join(trialDir, "workspace");
  const copiedSkillPath = join(workspace, ".agents", "skills", "plan-to-tickets", "SKILL.md");

  await mkdir(join(workspace, ".agents", "skills", "plan-to-tickets"), { recursive: true });
  await mkdir(join(workspace, ".eval"), { recursive: true });
  await cp(join(options.skillEvalsDir, "fixtures", "workspace"), workspace, { recursive: true });
  await cp(join(options.skillDir, "SKILL.md"), copiedSkillPath);

  const instruction = await readFile(join(options.skillEvalsDir, "instructions", "team-members.md"), "utf8");
  const agentRun = await runPi({
    cwd: workspace,
    prompt: instruction,
    trajectoryPath: join(workspace, ".eval", "pi-events.jsonl"),
    skillPath: copiedSkillPath,
    tools: ["read", "bash", "edit", "write"],
  });
  await writeFile(join(trialDir, "agent-response.md"), agentRun.response);
  if (agentRun.error) throw new Error(`Evaluated agent failed: ${agentRun.error}`);

  const deterministic = await gradeDeterministically(workspace);
  const ticketEntries = await readTicketSet(workspace);
  const candidatePath = join(trialDir, "candidate.md");
  await writeFile(candidatePath, ticketEntries);
  const semantic = await gradeSemantically({
    cwd: workspace,
    rubricPath: join(options.skillEvalsDir, "rubrics", "team-members.md"),
    artifactPath: candidatePath,
    trajectoryPath: join(trialDir, "judge-events.jsonl"),
  });
  const score = deterministic.score * weights.deterministic + semantic.score * weights.semantic;
  const result: TrialResult = { trial: options.trial, deterministic, semantic, score, workspace };
  await writeFile(join(trialDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

  return result;
}

async function readTicketSet(workspace: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const ticketDir = join(workspace, "tickets");
  const files = (await readdir(ticketDir))
    .filter((file) => /^\d+\.md$/.test(file))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
  const contents = await Promise.all(files.map(async (file) => `# Ticket file: ${file}\n\n${await readFile(join(ticketDir, file), "utf8")}`));
  return contents.join("\n\n---\n\n");
}

export const evaluation = {
  name: "plan-to-tickets",
  weights,
  runTrial,
} satisfies SkillEvaluation;
