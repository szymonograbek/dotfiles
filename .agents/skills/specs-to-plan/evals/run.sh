#!/usr/bin/env bash
set -euo pipefail

exec "$(dirname "$0")/../../evals/run.sh" specs-to-plan "$@"
