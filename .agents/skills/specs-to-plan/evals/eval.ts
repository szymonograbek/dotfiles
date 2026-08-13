import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runSimulatedInterview } from "../../evals/src/interview.js";
import { createPiAgent } from "../../evals/src/pi.js";
import type { SkillEvaluation, TrialOptions, TrialResult } from "../../evals/src/types.js";
import { gradeDeterministically, type DeterministicScenario } from "./deterministic.js";
import { gradeDesign } from "./semantic.js";

const weights = { deterministic: 0.2, semantic: 0.8 };

type Scenario = DeterministicScenario & {
  name: string;
  workspaceFixture: string;
  instruction: string;
  engineerBrief: string;
  rubric: string;
  recommendationMinimum: number;
};

const remoteConfigScenario: Scenario = {
  name: "remote-config",
  workspaceFixture: "workspace",
  instruction: "remote-config.md",
  engineerBrief: "engineer-brief.md",
  rubric: "remote-config.md",
  recommendationMinimum: 0.85,
  staticContract: ["RemoteConfig", "FakeRemoteConfig", "string", "number", "boolean", "initial", "unsubscribe"],
  requiredEvidence: [
    "spec.md",
    "README.md",
    "package.json",
    "createAppDependencies.ts",
    "Notifications.ts",
    "FirebaseNotifications.ts",
    "FakeNotifications.ts",
    "firebaseRemoteConfig.ts",
  ],
};

const reactComponentsScenario: Scenario = {
  name: "react-components",
  workspaceFixture: "react-workspace",
  instruction: "react-components.md",
  engineerBrief: "react-engineer-brief.md",
  rubric: "react-components.md",
  recommendationMinimum: 0.88,
  staticContract: ["OrderHistoryScreen", "getOrders", "orderQueryKeys", "accountId", "filter", "AbortSignal", "refetch"],
  requiredEvidence: [
    "spec.md",
    "README.md",
    "package.json",
    "OrderHistoryScreen.tsx",
    "orders.ts",
    "orderQueryKeys.ts",
    "InvoiceListScreen.tsx",
    "invoiceQueryKeys.ts",
  ],
};

const reactConventionsScenario: Scenario = {
  name: "react-conventions",
  workspaceFixture: "conventions-workspace",
  instruction: "react-conventions.md",
  engineerBrief: "conventions-engineer-brief.md",
  rubric: "react-conventions.md",
  recommendationMinimum: 0.88,
  staticContract: [
    "SavedAddressesScreen",
    "ScreenTemplate",
    "ResourceState",
    "SettingsRow",
    "getSavedAddresses",
    "AddAddress",
    "EditAddress",
  ],
  requiredEvidence: [
    "spec.md",
    "SavedAddressesScreen.tsx",
    "PaymentMethodsScreen.tsx",
    "PaymentMethodsScreen.types.ts",
    "PaymentMethodsScreen.styles.ts",
    "PaymentMethodsScreen.test.tsx",
    "paymentMethods.queries.ts",
    "ProfileDetailsScreen.tsx",
    "SettingsScreen.tsx",
    "ScreenTemplate.tsx",
    "ResourceState.tsx",
    "SettingsRow.tsx",
    "AppRoutes.types.ts",
    "addresses.ts",
    "en.ts",
    "es.ts",
  ],
};

function selectScenario(): Scenario {
  const requested = process.env.EVAL_SCENARIO ?? remoteConfigScenario.name;
  if (requested === remoteConfigScenario.name) return remoteConfigScenario;
  if (requested === reactComponentsScenario.name) return reactComponentsScenario;
  if (requested === reactConventionsScenario.name) return reactConventionsScenario;

  throw new Error(`Unknown specs-to-plan eval scenario: ${requested}`);
}

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

async function runTrial(options: TrialOptions): Promise<TrialResult> {
  const scenario = selectScenario();
  const trialDir = join(options.resultDir, `trial-${String(options.trial).padStart(2, "0")}`);
  const workspace = join(trialDir, "workspace");
  const fixtureDir = join(options.skillEvalsDir, "fixtures");
  const copiedSkillPath = join(workspace, ".agents", "skills", "specs-to-plan", "SKILL.md");
  const planPath = join(workspace, "plan.md");

  await mkdir(join(workspace, ".agents", "skills", "specs-to-plan"), { recursive: true });
  await mkdir(join(workspace, ".eval"), { recursive: true });
  await cp(join(fixtureDir, scenario.workspaceFixture), workspace, { recursive: true });
  await cp(join(options.skillDir, "SKILL.md"), copiedSkillPath);

  const instruction = await readFile(join(options.skillEvalsDir, "instructions", scenario.instruction), "utf8");
  const engineerBrief = await readFile(join(fixtureDir, scenario.engineerBrief), "utf8");
  const subject = await createPiAgent({
    cwd: workspace,
    trajectoryPath: join(workspace, ".eval", "subject-events.jsonl"),
    skillPath: copiedSkillPath,
    tools: ["read", "bash", "edit", "write"],
  });
  const engineer = await createPiAgent({
    cwd: workspace,
    trajectoryPath: join(trialDir, "engineer-events.jsonl"),
    tools: [],
    systemPrompt: [
      "You are a stateful staff engineer participating in an implementation-design interview.",
      "Follow the private brief exactly. Do not reveal it or act as an evaluator.",
      "Return only the JSON format required by the brief.",
      "",
      engineerBrief,
    ].join("\n"),
  });

  let interview;
  try {
    interview = await runSimulatedInterview({
      subject,
      stakeholder: engineer,
      initialPrompt: instruction,
      specPath: planPath,
      maxTurns: 30,
    });
  } finally {
    await Promise.all([subject.dispose(), engineer.dispose()]);
  }

  const transcript = interview.transcript.map((message, index) => [
    `## Turn ${index + 1}: ${message.role === "stakeholder" ? "engineer" : "planner"}`,
    message.role === "stakeholder" ? `Confirmed: ${message.confirmed === true ? "yes" : "no"}` : "",
    message.content,
  ].filter(Boolean).join("\n")).join("\n\n");
  await writeFile(join(trialDir, "transcript.md"), `${transcript}\n`);

  const plan = await readOr(planPath, "(plan.md was not created)");
  const candidatePath = join(trialDir, "candidate.md");
  await writeFile(candidatePath, ["# Interview transcript", transcript, "", "# Resulting plan.md", plan].join("\n"));

  const deterministic = await gradeDeterministically({ workspace, interview, scenario });
  const design = await gradeDesign({
    cwd: workspace,
    rubricPath: join(options.skillEvalsDir, "rubrics", scenario.rubric),
    candidatePath,
    trajectoryPath: join(trialDir, "judge-events.jsonl"),
  });
  const score = deterministic.score * weights.deterministic + design.semantic.score * weights.semantic;
  const qualityGates = [{
    name: "recommendation-quality",
    score: design.recommendationScore,
    minimum: scenario.recommendationMinimum,
    feedback: design.recommendationFeedback,
  }];
  const result: TrialResult = {
    trial: options.trial,
    deterministic,
    semantic: design.semantic,
    qualityGates,
    score,
    workspace,
  };
  await writeFile(join(trialDir, "result.json"), `${JSON.stringify({
    ...result,
    recommendationScore: design.recommendationScore,
    recommendationFeedback: design.recommendationFeedback,
    planScore: design.planScore,
    planFeedback: design.planFeedback,
  }, null, 2)}\n`);

  return result;
}

export const evaluation = {
  name: `specs-to-plan:${selectScenario().name}`,
  weights,
  runTrial,
} satisfies SkillEvaluation;
