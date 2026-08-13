#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

skill=${1:?Usage: ./evals/run.sh <skill-name> [--smoke|--regression] [vitest arguments]}
shift
export EVAL_SKILL=$skill

if [[ ! -d node_modules ]]; then
  npm install
fi

case "${1:-}" in
  --smoke)
    shift
    exec npm run smoke -- "$@"
    ;;
  --regression)
    shift
    exec npm run regression -- "$@"
    ;;
  *)
    exec npm test -- "$@"
    ;;
esac
