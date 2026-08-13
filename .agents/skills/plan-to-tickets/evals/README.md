# Plan-to-tickets evals

Evaluates whether a detailed agreed `specs-to-plan`-shaped `plan.md` is converted into self-contained, ordered tickets without losing implementation decisions.

```bash
./evals/run.sh --smoke
./evals/run.sh --regression
```

The fixture targets the known failure mode where a contract-rich plan becomes a vague ticket such as “implement TeamScreen.” Semantic grading checks that API, query, UI-state, failure, accessibility, analytics, testing, and sequencing details remain attached to the responsible tickets.

Scoring:

- deterministic structure and objective fact preservation: 30%;
- semantic decision traceability and implementability: 70%;
- passing threshold: 0.90.

Artifacts are retained under `$TMPDIR/skill-evals/plan-to-tickets/` by default.
