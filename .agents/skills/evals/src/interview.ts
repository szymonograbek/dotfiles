import { access } from "node:fs/promises";
import type { PiAgent } from "./pi.js";

export type InterviewMessage = {
  role: "interviewer" | "stakeholder";
  content: string;
  confirmed?: boolean;
};

export type SimulatedInterviewResult = {
  transcript: InterviewMessage[];
  confirmed: boolean;
  completed: boolean;
  specCreatedBeforeConfirmation: boolean;
  turns: number;
};

export function formatInterviewTranscript(
  interview: SimulatedInterviewResult,
  labels: { interviewer: string; stakeholder: string },
): string {
  return interview.transcript.map((message, index) => [
    `## Turn ${index + 1}: ${labels[message.role]}`,
    message.role === "stakeholder" ? `Confirmed: ${message.confirmed === true ? "yes" : "no"}` : "",
    message.content,
  ].filter(Boolean).join("\n")).join("\n\n");
}

type StakeholderTurn = {
  response: string;
  confirmed: boolean;
};

type SimulatedInterviewOptions = {
  subject: PiAgent;
  stakeholder: PiAgent;
  initialPrompt: string;
  specPath: string;
  maxTurns: number;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseStakeholderTurn(response: string): StakeholderTurn {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Stakeholder simulator returned no JSON: ${response}`);

  const value: unknown = JSON.parse(match[0]);
  if (typeof value !== "object" || value === null || !("response" in value) || !("confirmed" in value)) {
    throw new Error(`Stakeholder simulator returned invalid JSON: ${response}`);
  }
  if (typeof value.response !== "string" || typeof value.confirmed !== "boolean") {
    throw new Error(`Stakeholder simulator returned invalid fields: ${response}`);
  }

  return { response: value.response, confirmed: value.confirmed };
}

export async function runSimulatedInterview(options: SimulatedInterviewOptions): Promise<SimulatedInterviewResult> {
  const transcript: InterviewMessage[] = [];
  let confirmed = false;
  let specCreatedBeforeConfirmation = false;

  let subjectTurn = await options.subject.prompt(options.initialPrompt);
  if (subjectTurn.error) throw new Error(`Specs agent failed: ${subjectTurn.error}`);
  transcript.push({ role: "interviewer", content: subjectTurn.response });

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    if (await exists(options.specPath)) specCreatedBeforeConfirmation = !confirmed;

    const simulatorTurn = await options.stakeholder.prompt([
      "Respond to the interviewer's latest message below.",
      "Return only the required JSON object.",
      "",
      subjectTurn.response,
    ].join("\n"));
    if (simulatorTurn.error) throw new Error(`Stakeholder simulator failed: ${simulatorTurn.error}`);

    const stakeholderTurn = parseStakeholderTurn(simulatorTurn.response);
    confirmed ||= stakeholderTurn.confirmed;
    transcript.push({ role: "stakeholder", content: stakeholderTurn.response, confirmed: stakeholderTurn.confirmed });

    subjectTurn = await options.subject.prompt(stakeholderTurn.response);
    if (subjectTurn.error) throw new Error(`Specs agent failed: ${subjectTurn.error}`);
    transcript.push({ role: "interviewer", content: subjectTurn.response });

    const specExists = await exists(options.specPath);
    if (specExists && !confirmed) specCreatedBeforeConfirmation = true;
    if (specExists && confirmed) {
      return {
        transcript,
        confirmed,
        completed: true,
        specCreatedBeforeConfirmation,
        turns: turn,
      };
    }
  }

  return {
    transcript,
    confirmed,
    completed: false,
    specCreatedBeforeConfirmation,
    turns: options.maxTurns,
  };
}
