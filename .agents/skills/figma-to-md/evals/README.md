# Figma-to-Markdown evals

Task-specific fixtures and graders for `figma-to-md`. Shared Pi/Vitest infrastructure lives in [`../../evals/`](../../evals/).

## Run

```bash
./evals/run.sh --smoke       # one trial
./evals/run.sh --regression  # five trials
```

The eval combines deterministic checks (30%) with a Terra semantic rubric (70%). Its required combined score is defined in `baseline.json`.

Skill-specific contents:

- `eval.ts`: workspace setup and grading composition;
- `deterministic.ts`: objective/static checks;
- `fixtures/`: deterministic app and Figma evidence;
- `instructions/`: evaluated task prompt;
- `rubrics/`: qualitative grading criteria.

Run artifacts and trajectories are retained outside the repository under `$TMPDIR/skill-evals/figma-to-md/` by default. Set `EVAL_RESULTS_DIR` to retain them elsewhere.
