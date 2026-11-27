#!/usr/bin/env bash
# Tests that `run-checks.sh` ends with how long each stage and each check took,
# slowest first, so a slow engine job shows where its time went.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

. "$ROOT/packages/domicile-engine/tests/stand-ins/engine-checks.sh"
stand_in_engine_checks "$WORK/repo"
export DOMICILE_RENDER_NODE_LOCK="$WORK/card" DOMICILE_RENDER_NODE_NOISE="$WORK/noise"
# One serial check and one batched check take a while; the rest return at once.
cat >"$WORK/repo/stand-in.sh" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  (guard-shell) sleep 3 ;;
  (guard-webview-find) sleep 2 ;;
esac
[ "${FAIL:-}" = "$1" ] && exit 1
exit 0
STUB
chmod +x "$WORK/repo/stand-in.sh"

DOMICILE_CHECK_LOG_DIR="$WORK/logs" \
  "$WORK/repo/packages/domicile-engine/scripts/run-checks.sh" >"$WORK/out" 2>&1
times="$(sed -n '/^== how long the checks took ==$/,$p' "$WORK/out")"

[ -n "$times" ] && ok "a run ends with how long the checks took" ||
  fail "a run ends with how long the checks took" "$(cat "$WORK/out")"

seconds() { # name
  sed -nE "s/^ +([0-9]+)s $1\$/\1/p" <<<"$times"
}
[ "$(seconds guard-shell)" -ge 3 ] 2>/dev/null &&
  ok "it names a serial check with its seconds" ||
  fail "it names a serial check with its seconds" "$times"
[ "$(seconds guard-webview-find)" -ge 2 ] 2>/dev/null &&
  [ "$(seconds guard-webview-click)" -lt 2 ] 2>/dev/null &&
  ok "and a batched check with its own seconds, not the batch's" ||
  fail "and a batched check with its own seconds, not the batch's" "$times"
listed="$(sed -nE 's/^ +([0-9]+)s .*/\1/p' <<<"$times")"
[ -n "$listed" ] && [ "$listed" = "$(sort -rn <<<"$listed")" ] &&
  ok "slowest first" || fail "slowest first" "$times"

for stage in first together last; do
  [ -n "$(seconds "stage: $stage")" ] &&
    ok "it gives the $stage stage's total" ||
    fail "it gives the $stage stage's total" "$times"
done

# A failed run says the same, for the checks that ran.
FAIL=guard-two-windows DOMICILE_CHECK_LOG_DIR="$WORK/logs" \
  "$WORK/repo/packages/domicile-engine/scripts/run-checks.sh" >"$WORK/out" 2>&1
status=$?
[ "$status" -ne 0 ] && grep -qE '^ +[0-9]+s guard-two-windows$' "$WORK/out" &&
  ok "a failed run still says how long its checks took" ||
  fail "a failed run still says how long its checks took" "status $status: $(cat "$WORK/out")"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
