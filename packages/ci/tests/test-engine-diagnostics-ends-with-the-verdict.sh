#!/usr/bin/env bash
# Checks that `.github/scripts/engine-diagnostics.sh` ends with what each
# failed check and each probe said.
#
# Only the last 5000 lines of a job log can be read back, and the engine logs
# before them run to thousands. A check killed by its timeout writes no
# annotation, so its own log and its probe's are the only record of why.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DIAGNOSTICS="$ROOT/.github/scripts/engine-diagnostics.sh"
[ -x "$DIAGNOSTICS" ] || { echo "FAIL: no $DIAGNOSTICS" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

LOGS="$WORK/tmp"
mkdir -p "$LOGS/domicile-check-logs"
seq 1 300 | sed 's/^/engine noise /' >"$LOGS/domicile-shell-web-apis-no-cors-engine.log"
{
  echo "joined the browser's mojo graph at /tmp/domicile-shell-web-apis-broker-x"
  echo "[1:2:1015/182115.000:FATAL:probe_wait.cc] domicile: the browser never answered window capture 12 after 30s"
  seq 1 60 | sed 's/^/#/; s/$/ a stack frame/'
  echo "[end of stack trace]"
} >"$LOGS/domicile-shell-web-apis-no-cors-probe.log"
{
  seq 1 200 | sed 's/^/early guard line /'
  echo "::error::guard-shell-web-apis: the probe did not run for the control's no-cors leg"
  echo "engine-guard-shell-web-apis.sh ran past 1800s and was killed"
} >"$LOGS/domicile-check-logs/engine-guard-shell-web-apis.log"

out="$WORK/out"
DOMICILE_DIAGNOSTICS_LOGS="$LOGS" "$DIAGNOSTICS" >"$out" 2>&1

[ "$(tail -1 "$out")" = "    engine-guard-shell-web-apis.sh ran past 1800s and was killed" ] &&
  ok "the last line is the failed check's own last line" ||
  fail "the last line is the failed check's own last line" "it is: $(tail -1 "$out")"

probe="$(grep -n 'never answered window capture 12' "$out" | head -1 | cut -d: -f1)"
noise="$(grep -n 'engine noise' "$out" | tail -1 | cut -d: -f1)"
check="$(grep -n 'ran past 1800s' "$out" | tail -1 | cut -d: -f1)"
[ -n "$probe" ] && [ -n "$noise" ] && [ "$probe" -gt "$noise" ] && [ "$probe" -lt "$check" ] &&
  ok "a probe's fatal line, above its stack, comes after the engine logs" ||
  fail "a probe's fatal line, above its stack, comes after the engine logs" \
    "probe line ${probe:-none}, last engine line ${noise:-none}, check line ${check:-none}"

grep -q '^::error::' "$out" &&
  fail "a kept annotation is not raised a second time" "$(grep '^::error::' "$out")" ||
  ok "a kept annotation is not raised a second time"
grep -q "error: guard-shell-web-apis: the probe did not run" "$out" &&
  ok "but its text is shown" || fail "but its text is shown" "$(tail -40 "$out")"

[ "$FAILED" -eq 0 ] && echo "PASS: the engine diagnostics end with each failed check and probe"
[ "$FAILED" -eq 0 ]
