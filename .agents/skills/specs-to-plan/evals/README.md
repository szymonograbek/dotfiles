# Specs-to-plan evals

Three architecture scenarios exercise the skill through a simulated staff-engineer interview.

```bash
# Vendor-independent reactive API design (default)
./evals/run.sh --smoke
./evals/run.sh --regression

# React component state and async orchestration
EVAL_SCENARIO=react-components ./evals/run.sh --smoke
EVAL_SCENARIO=react-components ./evals/run.sh --regression

# React repository-convention discovery and reuse
EVAL_SCENARIO=react-conventions ./evals/run.sh --smoke
EVAL_SCENARIO=react-conventions ./evals/run.sh --regression
```

## Remote Config

The public specification requires typed initial values, Firebase isolation, key-specific live changes, and testability, but does not reveal the target API. The planner must independently recommend a minimal generic boundary, Firebase implementation, key-scoped value binding, centralized update fan-out, composition lifecycle, and mutable fake.

## React components

The public specification describes order filtering, retry, retained results, and stale-request safety without prescribing React mechanisms. Repository evidence includes both a problematic manually coordinated screen and an adjacent TanStack Query convention. The planner must recognize coherent server-state ownership, derive legal visual states, place user-caused transitions in event/query boundaries, use effects only for genuine external synchronization, and avoid overgeneralizing that every component needs a reducer or that effects are universally wrong.

## React conventions

The public specification contains only product stories. Repeated repository examples establish layout, state-presentation, row, feature-folder, query, navigation, localization, export, styling, and test conventions while a legacy target screen provides a tempting counterexample. The planner must inspect representative evidence, identify the dominant applicable patterns, reuse existing responsibilities, and avoid turning contextual syntax choices into universal rules.

## Scoring

- deterministic protocol/artifact checks: 20%;
- semantic recommendation and final-plan quality: 80%;
- overall passing threshold: 0.90;
- independent first-recommendation quality floor: 0.85 for Remote Config and 0.88 for both React scenarios.

A corrected final plan cannot compensate for poor initial recommendations. Artifacts and all trajectories are retained under `$TMPDIR/skill-evals/specs-to-plan/` by default.
