# Skill eval harness

Shared TypeScript/Vitest infrastructure for evaluating skills with the actual Pi SDK and `openai-codex/gpt-5.6-terra`.

## Run

```bash
./evals/run.sh figma-to-md --smoke       # one trial
./evals/run.sh figma-to-md --regression  # five trials

# Custom trial count or artifact location
EVAL_TRIALS=3 ./evals/run.sh figma-to-md
EVAL_RESULTS_DIR=/tmp/my-eval ./evals/run.sh figma-to-md --smoke
```

By default, results are retained outside the repository under `$TMPDIR/skill-evals/<skill>/<timestamp>/`.

## Evaluation principles

- Run the actual Pi agent through the SDK, not a mocked agent or prompt-only approximation.
- Isolate each trial in a fresh workspace and expose only the skill, tools, and fixture data required by the task.
- Keep external systems deterministic. Replace changing APIs such as Figma with fixture-backed tools.
- Separate objective checks from qualitative judgment.
- Use deterministic checks only for static facts with one correct answer: file paths, exact fixture values, required source IDs, inspected files/tools, and prohibited actions.
- Use a semantic rubric for meaning: completeness, grounding, unsupported claims, uncertainty handling, internal consistency, and implementability.
- Judge meaning rather than exact wording. Do not make stylistic variation fail deterministic checks.
- Give semantic quality enough weight that perfect keyword coverage cannot hide a materially poor artifact.
- Set a combined threshold that rejects known-bad outputs. `0.90` is a reasonable starting point for high-quality artifact generation.
- Run multiple trials before treating a change as a regression improvement. A smoke trial is only a fast feedback loop.
- Retain prompts, trajectories, artifacts, and grader feedback outside the repository so failures remain inspectable without polluting skill directories.
- Improve the skill with general rules derived from failures. Do not encode fixture-specific answers into `SKILL.md`.

## Add an evaluation

Create this structure beside the skill:

```text
<skill>/
├── SKILL.md
└── evals/
    ├── eval.ts
    ├── deterministic.ts
    ├── baseline.json
    ├── fixtures/
    ├── instructions/
    ├── rubrics/
    └── run.sh                 # optional convenience wrapper
```

### 1. Define a realistic task

Write the user request under `instructions/`. It should exercise the skill's real workflow and describe the outcome, not tell the agent how to satisfy the graders.

Choose a fixture that contains enough evidence to distinguish:

- a fully grounded result;
- a superficially complete result;
- unsupported assumptions or invented details.

Avoid embedding grader expectations in filenames or instructions when a real user would not provide them.

### 2. Build an isolated workspace

In `<skill>/evals/eval.ts`:

1. Create a fresh workspace under the supplied `resultDir`.
2. Copy only required app fixtures and `SKILL.md` into it.
3. Register deterministic fixture tools with `createTextFixtureTool`, or define a task-specific inline extension when richer behavior is needed.
4. Call `runPi` with the copied skill path and an explicit tool allowlist.
5. Save the agent response and trajectories.
6. Run deterministic and semantic graders.
7. Compute the weighted score and write `result.json`.
8. Export the configuration as `evaluation satisfies SkillEvaluation`.

Import reusable code from the root harness:

```ts
import { createTextFixtureTool } from "../../evals/src/fixture-tool.js";
import { runPi } from "../../evals/src/pi.js";
import { gradeSemantically } from "../../evals/src/semantic.js";
import type { SkillEvaluation } from "../../evals/src/types.js";
```

See `figma-to-md/evals/eval.ts` for a complete example.

### 3. Write deterministic checks

Deterministic graders should return `DeterministicResult` and explain every check. Good checks include:

- exactly one expected artifact exists;
- required static sections or identifiers are present;
- exact fixture copy and numeric values are preserved;
- required files or tools were inspected, using the Pi trajectory;
- prohibited tools were not called;
- forbidden side effects or downloaded files do not exist.

Do not deterministically grade prose quality, reasonable synonyms, ordering that does not affect meaning, or whether an explanation is sufficiently clear. Those belong in the semantic rubric.

### 4. Write the semantic rubric

Put verified task truth and scoring criteria in `rubrics/`. A useful rubric:

- lists the complete verified fixture evidence;
- states what the inspected app source proves and does not prove;
- identifies common unsupported inferences;
- assigns explicit weights to quality dimensions;
- requires deductions for omissions, contradictions, and invented details;
- asks the judge to evaluate meaning rather than wording.

Typical dimensions:

- completeness;
- grounding and uncertainty;
- implementation or output quality;
- internal consistency;
- scope discipline.

The semantic judge receives only the rubric and candidate artifact. Keep the rubric self-contained.

### 5. Choose weights and threshold

Weights belong in the exported evaluation. Favor semantic grading when keyword-complete artifacts can still be misleading:

```ts
const weights = { deterministic: 0.3, semantic: 0.7 };
```

Set the passing threshold in `baseline.json`:

```json
{
  "minimumScore": 0.9
}
```

Calibrate using real runs:

1. Run the current skill and inspect the artifact, trajectory, and both grader outputs.
2. Confirm known material defects cause failure.
3. Confirm a reference-quality output passes.
4. Check that deterministic failures represent objective violations.
5. Check that semantic feedback cites evidence from the rubric.
6. Run several trials to account for model variance.

Do not lower the threshold merely to make the current output pass.

### 6. Improve and verify the skill

When feedback reveals a real gap:

1. Translate it into a general instruction applicable beyond the fixture.
2. Edit `SKILL.md` minimally.
3. Rerun the eval after the final edit—not just an earlier intermediate edit.
4. Inspect semantic feedback even when the score passes.
5. Run the regression suite before relying on the change.

Examples of generalizable improvements include distinguishing component API compatibility from verified visual compatibility, preserving unknown properties as unknown, and avoiding claims that a partial token catalog proves global absence.

## Shared modules

- `src/workspace.ts`: standard trial/workspace paths, skill copying, and `.eval` setup.
- `src/pi.ts`: isolated Pi execution using Terra, JSONL trajectories, and response recording.
- `src/semantic.ts`: rubric-based Terra semantic grading.
- `src/deterministic.ts`: deterministic check aggregation and scoring.
- `src/files.ts`: optional UTF-8 artifact reads with explicit fallbacks.
- `src/fixture-tool.ts`: deterministic text-backed inline tools.
- `src/interview.ts`: stateful subject/stakeholder interview orchestration and transcript formatting.
- `src/types.ts`: shared evaluation contracts.
- `skill-evals.test.ts`: skill loading, thresholds, assertions, and aggregate summaries.

## Outputs

Each run records:

- the complete isolated workspace;
- the generated artifact;
- the agent's final response;
- agent and judge event trajectories;
- deterministic checks;
- semantic score and feedback;
- per-trial and aggregate JSON summaries.

The default temporary location avoids repository noise. Set `EVAL_RESULTS_DIR` to a persistent directory when CI should upload the artifacts.
