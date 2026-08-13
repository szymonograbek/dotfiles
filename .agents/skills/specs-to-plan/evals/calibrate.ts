import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeDesign } from "./semantic.js";

async function calibrate(): Promise<void> {
  const evalsDir = dirname(fileURLToPath(import.meta.url));
  const calibrationDir = join(evalsDir, "calibration");
  const rubricPath = join(evalsDir, "rubrics", "remote-config.md");
  const goldenPlan = await readFile(join(calibrationDir, "golden-plan.md"), "utf8");
  const cases = [
    { name: "good", transcript: "good-transcript.md", recommendation: "pass" },
    { name: "bad-vendor", transcript: "bad-vendor-transcript.md", recommendation: "fail" },
    { name: "bad-global", transcript: "bad-global-transcript.md", recommendation: "fail" },
  ];
  const workingDirectory = await mkdtemp(join(tmpdir(), "specs-to-plan-calibration-"));

  try {
    for (const calibration of cases) {
      const transcript = await readFile(join(calibrationDir, calibration.transcript), "utf8");
      const candidatePath = join(workingDirectory, `${calibration.name}.md`);
      await writeFile(candidatePath, `# Interview transcript\n${transcript}\n# Resulting plan.md\n${goldenPlan}`);
      const result = await gradeDesign({
        cwd: workingDirectory,
        rubricPath,
        candidatePath,
        trajectoryPath: join(workingDirectory, `${calibration.name}-judge.jsonl`),
      });
      const recommendationPassed = result.recommendationScore >= 0.85;
      const expectedPass = calibration.recommendation === "pass";
      if (recommendationPassed !== expectedPass || result.planScore < 0.85) {
        throw new Error(`${calibration.name} calibration failed: ${JSON.stringify(result)}`);
      }
      console.log(`${calibration.name}: recommendation=${result.recommendationScore.toFixed(2)}, plan=${result.planScore.toFixed(2)}`);
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

calibrate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
