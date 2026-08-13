import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { resultFromChecks } from "../../evals/src/deterministic.js";
import { readTextOr } from "../../evals/src/files.js";
import type { DeterministicResult, EvalCheck } from "../../evals/src/types.js";

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }

  return files;
}

export async function gradeDeterministically(workspace: string): Promise<DeterministicResult> {
  const checks: EvalCheck[] = [];
  const check = (name: string, passed: boolean, message: string) => {
    checks.push({ name, passed, message });
  };

  const designsPath = join(workspace, "designs");
  const designs = await readdir(designsPath, { withFileTypes: true }).catch(() => []);
  const markdownFiles = designs.filter((entry) => entry.isFile() && extname(entry.name) === ".md");
  check(
    "one-screen-one-file",
    markdownFiles.length === 1 && markdownFiles[0]?.name === "booking-confirmed.md",
    "Expected exactly designs/booking-confirmed.md",
  );

  const content = await readTextOr(join(designsPath, "booking-confirmed.md"));
  const requiredHeadings = [
    "## Source",
    "## Layout",
    "## Structure",
    "## Reusable components",
    "## Styling and tokens",
    "## Visual implementation notes",
  ];
  check("required-sections", requiredHeadings.every((heading) => content.includes(heading)), "Every required section is present");

  const exactCopy = ["You're all booked!", "We'll send a reminder 24 hours before your appointment.", 'Button: "Done"'];
  check("exact-copy", exactCopy.every((text) => content.includes(text)), "All visible copy is exact");
  check("structure-tree", content.includes("```txt") && content.includes("├") && content.includes("└"), "A plain semantic tree is present");

  const appReferences = ["PrimaryButton", "colors.background", "colors.textPrimary", "colors.textSecondary", "colors.accent"];
  check("app-source-references", appReferences.every((reference) => content.includes(reference)), "Supplied app sources are referenced");

  const designValues = [
    "390 × 844", "240 × 184", "148px", "40px", "56px", "32px", "24px", "16px", "12px",
    "28px/34px", "16px/24px", "#F7F7F5", "#1C1C1A", "#6F6F69", "#5B4CF0", "#FFFFFF",
  ];
  check("static-design-values", designValues.every((value) => content.includes(value)), "Every fixture value is present");

  const assetReferences = ["calendar-confetti.png", "AbC123Fixture", "42:108", "node-id=42-108"];
  check("source-asset-identifiers", assetReferences.every((reference) => content.includes(reference)), "Raster source identifiers are present");

  const workspaceFiles = await walk(workspace);
  const images = workspaceFiles.filter((path) => [".png", ".jpg", ".jpeg", ".webp"].includes(extname(path).toLowerCase()));
  check("no-asset-download", images.length === 0, "No source image was downloaded");

  const events = await readTextOr(join(workspace, ".eval", "pi-events.jsonl"));
  check("figma-inspected", events.includes("figma_get_design_context"), "The Figma fixture was inspected");
  check("app-inspected", events.includes("src/theme/tokens.ts") && events.includes("src/components/PrimaryButton.tsx"), "Relevant app sources were inspected");
  check("skill-loaded", events.includes("figma-to-md/SKILL.md"), "Pi loaded the skill");
  check("asset-download-not-called", !events.includes('"toolName":"download_assets"'), "download_assets was not called");

  return resultFromChecks(checks);
}
