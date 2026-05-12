# pi-hindsight

Local Pi extension port of `@vectorize-io/opencode-hindsight`.

## Setup

```bash
cd ~/.pi/agent/extensions/hindsight-pi
npm install
export HINDSIGHT_API_URL="http://localhost:8888"
# optional
export HINDSIGHT_API_TOKEN="..."
export HINDSIGHT_BANK_ID="my-project"
```

Pi auto-discovers `~/.pi/agent/extensions/hindsight-pi/index.ts`; run `/reload` after edits.

## Config

Optional config file: `~/.hindsight/pi.json`.

Env overrides supported: `HINDSIGHT_API_URL`, `HINDSIGHT_API_TOKEN`, `HINDSIGHT_BANK_ID`, `HINDSIGHT_AGENT_NAME`, `HINDSIGHT_AUTO_RECALL`, `HINDSIGHT_AUTO_RETAIN`, `HINDSIGHT_RETAIN_MODE`, `HINDSIGHT_RECALL_BUDGET`, `HINDSIGHT_RECALL_MAX_TOKENS`, `HINDSIGHT_RECALL_MAX_QUERY_CHARS`, `HINDSIGHT_RECALL_CONTEXT_TURNS`, `HINDSIGHT_DYNAMIC_BANK_ID`, `HINDSIGHT_BANK_MISSION`, `HINDSIGHT_DEBUG`, `HINDSIGHT_VERBOSE`, `HINDSIGHT_RECALL_TAGS`.

Set `HINDSIGHT_VERBOSE=true` or `{ "verbose": true }` to print exact recalled memories and retained transcripts to stderr.

## Tools

- `hindsight_retain`
- `hindsight_recall`
- `hindsight_reflect`

Auto-recall is injected into Pi's system prompt before each agent turn. Auto-retain runs after agent completion and before compaction.
