#!/usr/bin/env bash
# Collect the current user's completed work in the current git repo within a date range.
#
# Usage:
#   collect-work.sh                       # today (local tz)
#   collect-work.sh today
#   collect-work.sh yesterday
#   collect-work.sh "this week"
#   collect-work.sh "last 3 days"
#   collect-work.sh 2026-05-21
#   collect-work.sh 2026-05-18..2026-05-21
#
# Output: JSON on stdout:
# {
#   "range": { "startLocal": "...", "endLocal": "...", "startISO": "...", "endISO": "..." },
#   "repo":  { "name": "...", "owner": "...", "defaultBranch": "...", "isGithub": true|false },
#   "user":  { "name": "...", "email": "..." },
#   "prs":     [ { "number", "title", "url", "mergedAt", "headRefName", "mergeCommit" } ],
#   "commits": [ { "sha", "shortSha", "subject", "authoredAt", "url" } ],   # default-branch commits not covered by a collected PR
#   "warnings": [ "..." ]
# }
#
# Exit non-zero only on hard failures (not a git repo, missing tools, bad range).
set -euo pipefail

RANGE_INPUT="${1:-today}"

warn() { warnings+=("$1"); }
warnings=()

# --- tool checks
command -v git  >/dev/null || { echo "git not found" >&2; exit 2; }
command -v jq   >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v node >/dev/null || { echo "node not found (used for date math)" >&2; exit 2; }

# --- repo & identity
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repo" >&2; exit 2; }
USER_EMAIL="$(git config user.email || true)"
USER_NAME="$(git config user.name  || true)"
[ -n "$USER_EMAIL" ] || { echo "git user.email not set" >&2; exit 2; }

IS_GITHUB=false; REPO_NAME=""; REPO_OWNER=""; DEFAULT_BRANCH=""
if command -v gh >/dev/null && gh repo view --json name,owner,defaultBranchRef >/dev/null 2>&1; then
  IS_GITHUB=true
  REPO_JSON="$(gh repo view --json name,owner,defaultBranchRef)"
  REPO_NAME="$(jq -r '.name' <<<"$REPO_JSON")"
  REPO_OWNER="$(jq -r '.owner.login' <<<"$REPO_JSON")"
  DEFAULT_BRANCH="$(jq -r '.defaultBranchRef.name' <<<"$REPO_JSON")"
else
  # fall back to local default branch detection
  DEFAULT_BRANCH="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
  [ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  # try to infer owner/name from origin url
  origin_url="$(git config --get remote.origin.url || true)"
  if [[ "$origin_url" =~ github.com[:/]+([^/]+)/([^/.]+) ]]; then
    REPO_OWNER="${BASH_REMATCH[1]}"
    REPO_NAME="${BASH_REMATCH[2]}"
  fi
  warn "gh CLI unavailable or not authenticated; PR list will be empty"
fi

# --- resolve date range via node
IFS='|' read -r START_LOCAL END_LOCAL START_ISO END_ISO <<<"$(node -e '
const input = process.argv[1].trim().toLowerCase();
function fmtLocal(d){ const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function startOfDay(d){ d=new Date(d); d.setHours(0,0,0,0); return d; }
function addDays(d,n){ d=new Date(d); d.setDate(d.getDate()+n); return d; }
let start, end;
const now = new Date();
const today = startOfDay(now);
const ymd = /^(\d{4})-(\d{2})-(\d{2})$/;
const ymdRange = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/;
const lastN = /^last\s+(\d+)\s+days?$/;
let m;
if (input === "" || input === "today") { start = today; end = addDays(today,1); }
else if (input === "yesterday") { start = addDays(today,-1); end = today; }
else if (input === "this week") {
  const dow = (today.getDay()+6)%7; // Mon=0
  start = addDays(today,-dow); end = addDays(today,1);
}
else if ((m=input.match(lastN))) { start = addDays(today,-parseInt(m[1],10)+1); end = addDays(today,1); }
else if ((m=input.match(ymd)))   { start = new Date(+m[1],+m[2]-1,+m[3]); end = addDays(start,1); }
else if ((m=input.match(ymdRange))) {
  start = new Date(+m[1],+m[2]-1,+m[3]);
  end   = addDays(new Date(+m[4],+m[5]-1,+m[6]), 1);
}
else { console.error("unrecognized range: "+input); process.exit(3); }
process.stdout.write([fmtLocal(start), fmtLocal(end), start.toISOString(), end.toISOString()].join("|"));
' "$RANGE_INPUT")"

# --- fetch latest default branch ref (best-effort)
if [ "$IS_GITHUB" = true ] || git remote get-url origin >/dev/null 2>&1; then
  git fetch --quiet origin "$DEFAULT_BRANCH" 2>/dev/null || warn "git fetch failed; commit list may be stale"
fi

# --- PRs merged in range by current user
PRS_JSON="[]"
PR_MERGE_SHAS=()
if [ "$IS_GITHUB" = true ]; then
  # gh accepts YYYY-MM-DD in merged: filter; convert local ISO to date
  start_date="${START_LOCAL%% *}"
  end_local_date="${END_LOCAL%% *}"
  end_date_inclusive="$(node -e '
    const d=new Date(process.argv[1]); d.setDate(d.getDate()-1);
    const p=n=>String(n).padStart(2,"0");
    process.stdout.write(`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`);
  ' "$end_local_date")"
  if PRS_RAW="$(gh pr list --author "@me" --state merged \
      --search "merged:${start_date}..${end_date_inclusive}" \
      --json number,title,url,mergedAt,headRefName,mergeCommit \
      --limit 200 2>/dev/null)"; then
    PRS_JSON="$(jq '[.[] | {number, title, url, mergedAt, headRefName, mergeCommit: (.mergeCommit.oid // null)}]' <<<"$PRS_RAW")"
    while IFS= read -r sha; do
      [ -n "$sha" ] && [ "$sha" != "null" ] && PR_MERGE_SHAS+=("$sha")
    done < <(jq -r '.[].mergeCommit' <<<"$PRS_JSON")
  else
    warn "gh pr list failed"
  fi
fi

# --- commits on default branch in range by current user
COMMIT_LINES="$(git log "origin/${DEFAULT_BRANCH}" \
  --author="$USER_EMAIL" \
  --since="$START_LOCAL" --until="$END_LOCAL" \
  --no-merges \
  --pretty=format:'%H%x09%s%x09%aI' 2>/dev/null || true)"

# Build set of SHAs reachable from any collected PR merge commit (to exclude from "orphan commits")
EXCLUDE_SHAS_FILE="$(mktemp)"
trap 'rm -f "$EXCLUDE_SHAS_FILE"' EXIT
for merge_sha in "${PR_MERGE_SHAS[@]:-}"; do
  [ -z "$merge_sha" ] && continue
  # commits introduced by this merge: merge_sha^1..merge_sha (the PR side)
  git rev-list "${merge_sha}^1..${merge_sha}" 2>/dev/null >>"$EXCLUDE_SHAS_FILE" || true
done
sort -u -o "$EXCLUDE_SHAS_FILE" "$EXCLUDE_SHAS_FILE"

COMMITS_JSON="[]"
if [ -n "$COMMIT_LINES" ]; then
  COMMITS_JSON="$(
    while IFS=$'\t' read -r sha subject authored; do
      [ -z "$sha" ] && continue
      if [ -s "$EXCLUDE_SHAS_FILE" ] && grep -qx "$sha" "$EXCLUDE_SHAS_FILE"; then continue; fi
      short="${sha:0:8}"
      if [ -n "$REPO_OWNER" ] && [ -n "$REPO_NAME" ]; then
        url="https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${sha}"
      else
        url=""
      fi
      jq -n --arg sha "$sha" --arg short "$short" --arg subj "$subject" \
            --arg at "$authored" --arg url "$url" \
            '{sha:$sha, shortSha:$short, subject:$subj, authoredAt:$at, url:$url}'
    done <<<"$COMMIT_LINES" | jq -s '.'
  )"
fi

# --- assemble output
WARN_JSON="$(printf '%s\n' "${warnings[@]:-}" | jq -R . | jq -s 'map(select(length>0))')"

jq -n \
  --arg startLocal "$START_LOCAL" --arg endLocal "$END_LOCAL" \
  --arg startISO "$START_ISO"   --arg endISO  "$END_ISO" \
  --arg name "$REPO_NAME" --arg owner "$REPO_OWNER" \
  --arg branch "$DEFAULT_BRANCH" --argjson isGithub "$IS_GITHUB" \
  --arg uname "$USER_NAME" --arg uemail "$USER_EMAIL" \
  --argjson prs "$PRS_JSON" --argjson commits "$COMMITS_JSON" \
  --argjson warnings "$WARN_JSON" \
  '{
     range:    {startLocal:$startLocal, endLocal:$endLocal, startISO:$startISO, endISO:$endISO},
     repo:     {name:$name, owner:$owner, defaultBranch:$branch, isGithub:$isGithub},
     user:     {name:$uname, email:$uemail},
     prs:      $prs,
     commits:  $commits,
     warnings: $warnings
   }'
