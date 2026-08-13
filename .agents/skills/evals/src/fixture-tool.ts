import { readFile } from "node:fs/promises";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type FixtureToolOptions = {
  name: string;
  label: string;
  description: string;
  fixturePath: string;
  expectedArguments: Record<string, string>;
};

export function createTextFixtureTool(options: FixtureToolOptions): InlineExtension {
  return {
    name: options.name,
    factory: (pi) => {
      pi.registerTool({
        name: options.name,
        label: options.label,
        description: options.description,
        parameters: Type.Record(Type.String(), Type.String()),
        async execute(_toolCallId, params) {
          for (const [key, expected] of Object.entries(options.expectedArguments)) {
            if (params[key] !== expected) {
              throw new Error(`Unexpected ${options.name} argument ${key}: ${params[key] ?? "<missing>"}`);
            }
          }

          const content = await readFile(options.fixturePath, "utf8");
          return {
            content: [{ type: "text", text: content }],
            details: { fixturePath: options.fixturePath },
          };
        },
      });
    },
  };
}
