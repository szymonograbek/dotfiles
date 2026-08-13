import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";

const MODEL_PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.6-terra";

export type PiRun = {
  response: string;
  error?: string;
};

export type PiAgentOptions = {
  cwd: string;
  trajectoryPath: string;
  skillPath?: string;
  inlineExtensions?: InlineExtension[];
  tools?: string[];
  systemPrompt?: string;
};

export type PiAgent = {
  prompt(text: string): Promise<PiRun>;
  dispose(): Promise<void>;
};

export async function createPiAgent(options: PiAgentOptions): Promise<PiAgent> {
  const modelRuntime = await ModelRuntime.create();
  const model = modelRuntime.getModel(MODEL_PROVIDER, MODEL_ID);
  if (!model) {
    throw new Error(`Pi model is unavailable: ${MODEL_PROVIDER}/${MODEL_ID}`);
  }

  await mkdir(dirname(options.trajectoryPath), { recursive: true });
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: getAgentDir(),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: options.inlineExtensions ?? [],
    additionalSkillPaths: options.skillPath ? [options.skillPath] : [],
    systemPromptOverride: options.systemPrompt ? () => options.systemPrompt : undefined,
  });
  await resourceLoader.reload();

  const { session, extensionsResult } = await createAgentSession({
    cwd: options.cwd,
    model,
    modelRuntime,
    thinkingLevel: "medium",
    tools: options.tools,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(options.cwd),
  });

  if (extensionsResult.errors.length > 0) {
    session.dispose();
    throw new Error(`Extension loading failed: ${JSON.stringify(extensionsResult.errors)}`);
  }

  const events: string[] = [];
  const unsubscribeEvents = session.subscribe((event) => {
    events.push(JSON.stringify(event));
  });

  return {
    async prompt(text) {
      let response = "";
      let error: string | undefined;
      const unsubscribeResponse = session.subscribe((event) => {
        if (event.type !== "message_update") return;
        if (event.assistantMessageEvent.type === "text_delta") {
          response += event.assistantMessageEvent.delta;
        }
        if (event.assistantMessageEvent.type === "error") {
          error = event.assistantMessageEvent.error.errorMessage ?? event.assistantMessageEvent.reason;
        }
      });

      try {
        await session.prompt(text);
        await session.agent.waitForIdle();
        await writeFile(options.trajectoryPath, `${events.join("\n")}\n`);
        return error ? { response, error } : { response };
      } finally {
        unsubscribeResponse();
      }
    },
    async dispose() {
      unsubscribeEvents();
      session.dispose();
      await writeFile(options.trajectoryPath, `${events.join("\n")}\n`);
    },
  };
}

type RunPiOptions = PiAgentOptions & {
  prompt: string;
};

export async function runPi(options: RunPiOptions): Promise<PiRun> {
  const agent = await createPiAgent(options);

  try {
    return await agent.prompt(options.prompt);
  } finally {
    await agent.dispose();
  }
}
