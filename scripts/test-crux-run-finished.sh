#!/usr/bin/env bash
# Tests `crux-run-finished.sh`: only GitHub's `completed` status means the slot
# holder's run is over. Any other status is "no", and a failed query is "could
# not ask", never "yes", since "yes" frees a slot a live build may be using.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SH="$ROOT/.github/scripts/crux-run-finished.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  if [ "$2" = "$3" ]; then printf '  ok    %s\n' "$1"
  else printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"; FAILED=$((FAILED + 1)); fi
}

# A curl stub that answers with $STATUS and records the URL, or fails.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
for a in "$@"; do url="$a"; done
echo "$url" >"$WORK_DIR/asked"
[ "$STATUS" = fail ] && { echo "curl: (6) could not resolve host" >&2; exit 6; }
printf '{"id": 1, "status": "%s"}' "$STATUS"
STUB
chmod +x "$WORK/bin/curl"

ask() { # status, owner
  STATUS="$1" WORK_DIR="$WORK" PATH="$WORK/bin:$PATH" GH_TOKEN=t GITHUB_REPOSITORY=o/r \
    "$SH" "$2" >/dev/null 2>&1
  echo $?
}

expect "a completed run is over" 0 "$(ask completed 'engine.yml run 36923792412 attempt 1')"
expect "and it asked about that run's attempt" \
  "https://api.github.com/repos/o/r/actions/runs/36923792412/attempts/1" "$(cat "$WORK/asked")"
expect "an in-progress run is not" 1 "$(ask in_progress 'engine.yml run 5 attempt 2')"
expect "nor a queued one" 1 "$(ask queued 'engine-release.yml run 5 attempt 1')"
expect "a GitHub that cannot be reached is not a yes" 3 "$(ask fail 'engine.yml run 5 attempt 1')"
expect "an owner that names no run is not a yes" 3 "$(ask completed 'connor at a terminal')"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
