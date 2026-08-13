#!/usr/bin/env bash
set -euo pipefail
exec "$(dirname "$0")/../../evals/run.sh" ready-to-review "$@"
