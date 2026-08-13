# Specs evals

A Terra specs agent interviews a separate stateful Terra stakeholder simulator about a compact, single-story list-renaming feature, then writes `spec.md` after explicit confirmation.

```bash
./evals/run.sh --smoke       # one interview
./evals/run.sh --regression  # five interviews
```

The simulator sees a private product brief but not the skill or rubric. It answers only the current question, rejects and withholds selected decisions, and confirms only after an accurate recap. The default scenario is intentionally compact so ordinary runs reliably reach and grade a final artifact. The previous comprehensive saved-search-alert scenario is retained under `stress/` but is not part of normal runs.

Scoring:

- deterministic interview protocol: 20%;
- semantic transcript and final-spec quality: 80%;
- passing threshold: 0.90.

Artifacts, complete transcripts, workspaces, and all three Pi trajectories are retained under `$TMPDIR/skill-evals/specs/` by default.
