# Ready-to-review evals

The stacked-jj scenario reproduces three handoff failures:

- treating an undescribed jj working-copy commit as uncommitted work and stopping;
- naming or summarizing only the top change instead of the complete review range;
- choosing the repository default PR base instead of the stack's actual parent bookmark.

It runs against deterministic fixture-backed `jj`, `gh`, and Jira CLIs. All mutations stay inside the trial workspace.

```bash
./evals/run.sh --smoke
./evals/run.sh --regression
```

Scoring emphasizes objective remote/VCS state and semantic reviewer/QA quality. The fixture user explicitly authorizes metadata normalization so unnecessary clarification is a failure, not a safety requirement.
