#!/usr/bin/env bash
# A pull request whose engine write-back is still coming is not red.
#
# `test-the-pinned-engine-is-this-series.sh` fails whenever the series in hand
# differs from the one `engine-release.nix` names. On a pull request that moves
# the fork that is "not yet": `engine.yml` publishes the release and writes the
# file back onto the branch, and until it does, every e2e run was red — 37 of
# 113 in one day, hiding the real failures beside them.
#
# So on a pull request, and only there, a mismatch whose engine run is still
# going is a skip. Every other mismatch still fails, and each has a case:
#
#   - main (no pull request named), whatever the engine is doing;
#   - an engine run that finished and wrote nothing back;
#   - no engine run at all;
#   - a pin that is neither this series nor the base's, which no write-back
#     explains — somebody edited the generated file.
#
# The API half is faked. What is under test is the decision, not GitHub.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$ROOT/scripts/test-the-pinned-engine-is-this-series.sh"
[ -x "$CHECK" ] || { echo "no $CHECK" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || {
  echo "SKIP: no jq, which the check reads the API with"
  exit 77
}

WORK="$(mktemp -d)"
RELEASE="$ROOT/packages/domicile-engine/engine-release.nix"
cp "$RELEASE" "$WORK/engine-release.nix.orig"
restore() { cp "$WORK/engine-release.nix.orig" "$RELEASE"; }
trap 'restore; rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    sed 's/^/    | /' "$WORK/said"
    FAILED=$((FAILED + 1))
  fi
}

HEAD_SHA=1111111111111111111111111111111111111111
BASE_SHA=2222222222222222222222222222222222222222
OLD=0000000000000000000000000000000000000000000000000000000000000000
BOGUS=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
IDENTITY="$(cd "$ROOT" && .github/scripts/engine-series-stamp.sh identity)"

# GitHub, as far as the check can tell: engine.yml's runs for `$HEAD_SHA` have
# the statuses in `$FAKE_RUNS`, and the base's engine-release.nix pins `$OLD`.
BIN="$WORK/bin"
mkdir -p "$BIN"
cat > "$BIN/curl" <<FAKE
#!/usr/bin/env bash
url="\${!#}"
case "\$url" in
  */actions/workflows/engine.yml/runs\?*head_sha=$HEAD_SHA*)
    jq -n --arg s "\$(cat "\$FAKE_RUNS")" \
      '{workflow_runs: (\$s | split(" ") | map(select(. != "")) | map({status: .}))}' ;;
  */actions/workflows/engine.yml/runs\?*)
    echo '{"workflow_runs": []}' ;;
  */contents/packages/domicile-engine/engine-release.nix\?ref=$BASE_SHA)
    printf '{\n  identity = "%s";\n}\n' "$OLD" ;;
  *) echo "fake curl: no such endpoint \$url" >&2; exit 22 ;;
esac
FAKE
chmod +x "$BIN/curl"

pins() { # identity to write into the generated file
  sed -i "s/^  identity = \".*\";/  identity = \"$1\";/" "$RELEASE"
}

# Exit status of the check. $1 is the engine runs' statuses; $2 is `pr` to run
# as the pull request e2e.yml describes, or `main` to run as a push.
check() {
  printf '%s' "$1" >"$WORK/runs"
  if [ "$2" = pr ]; then
    env PATH="$BIN:$PATH" FAKE_RUNS="$WORK/runs" GITHUB_TOKEN=fake \
      GITHUB_REPOSITORY=cprussin/domicile \
      DOMICILE_PR_HEAD_SHA="$HEAD_SHA" DOMICILE_PR_BASE_SHA="$BASE_SHA" \
      "$CHECK" >"$WORK/said" 2>&1
  else
    env PATH="$BIN:$PATH" FAKE_RUNS="$WORK/runs" GITHUB_TOKEN=fake \
      GITHUB_REPOSITORY=cprussin/domicile \
      "$CHECK" >"$WORK/said" 2>&1
  fi
  echo "$?"
}

echo "== main =="

restore; pins "$OLD"
expect "a mismatch on main fails, even with an engine run going" \
  1 "$(check in_progress main)"

echo
echo "== a pull request waiting on its write-back =="

restore; pins "$OLD"
expect "an engine run in progress is a skip" 77 "$(check in_progress pr)"
expect "and says why" 1 "$(grep -c '^SKIP: .*write-back' "$WORK/said")"
expect "a queued one is too" 77 "$(check queued pr)"

echo
echo "== a pull request after its write-back =="

restore; pins "$IDENTITY"
expect "the pin names this series: it passes" 0 "$(check completed pr)"

echo
echo "== a pull request no write-back will fix =="

restore; pins "$OLD"
expect "an engine run that finished without writing back fails" \
  1 "$(check completed pr)"
expect "and says so" 1 "$(grep -c 'finished without writing back' "$WORK/said")"
expect "no engine run at all fails" 1 "$(check "" pr)"
expect "and says so" 1 "$(grep -c 'has no run for' "$WORK/said")"

restore; pins "$BOGUS"
expect "a pin that is neither this series nor the base's fails" \
  1 "$(check in_progress pr)"
expect "and says so" 1 "$(grep -c 'not the base' "$WORK/said")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the-pinned-engine-check-waits-for-the-write-back: all cases passed"
else
  echo "the-pinned-engine-check-waits-for-the-write-back: $FAILED case(s) failed"
fi
exit "$FAILED"
