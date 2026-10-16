#!/usr/bin/env bash
# Checks that the engine library's spike probes wait a bounded time for the
# browser's answer, and stop the producer loudly when it never comes.
#
# Each probe call blocks its caller until the browser answers. Unbounded, a
# capture viz never serves, or a pipe whose browser is gone, holds a guard
# until the check's timeout with nothing in its log to say why.
#
# The wait lives in `src/components/domicile/engine/probe_wait.cc`. Reads `src/`
# and the unit test list, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine/src/components/domicile"
LIBRARY="$ENGINE/engine/domicile_engine.cc"
[ -f "$LIBRARY" ] || { echo "FAIL: no $LIBRARY" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

for f in probe_wait.h probe_wait.cc probe_wait_unittest.cc; do
  [ -f "$ENGINE/engine/$f" ] && ok "engine/$f exists" ||
    fail "engine/$f exists" "no such file under src/components/domicile/engine"
done

# The body of each probe call, from its signature to the next member.
body_of() { # function name
  awk -v name="$1" '
    $0 ~ "void " name "\\(" { on = 1 }
    on && /^  }$/ { print; exit }
    on { print }' "$LIBRARY"
}

for call in SampleWindowCenterOnThread SamplePixelOnThread FindColorOnThread; do
  body="$(body_of "$call")"
  if [ -z "$body" ]; then
    fail "$call waits a bounded time" "no $call in domicile_engine.cc"
  elif printf '%s\n' "$body" | grep -q 'loop\.Run()'; then
    fail "$call waits a bounded time" \
      "it runs its loop with no deadline; wait with AwaitProbe instead"
  elif ! printf '%s\n' "$body" | grep -q 'AwaitProbe('; then
    fail "$call waits a bounded time" "it does not wait with AwaitProbe"
  else
    ok "$call waits a bounded time"
  fi
done

grep -q 'RunUntilQuit(' "$LIBRARY" && grep -q 'LOG(FATAL) << domicile::NeverAnswered(' "$LIBRARY" &&
  ok "a probe the browser never answers stops the producer, naming the request" ||
  fail "a probe the browser never answers stops the producer, naming the request" \
    "AwaitProbe should LOG(FATAL) with NeverAnswered when RunUntilQuit runs out"

# An unregistered test is not linked, and a `--gtest_filter` matching nothing
# exits zero.
grep -q '"//components/domicile/engine:probe_wait_unit_tests"' "$ENGINE/BUILD.gn" &&
  ok "the unit test is in domicile_unittests" ||
  fail "the unit test is in domicile_unittests" \
    "components/domicile/BUILD.gn does not depend on :probe_wait_unit_tests"
grep -q 'ProbeWaitTest\.\*' "$ROOT/scripts/engine-unit-tests.sh" &&
  ok "the unit test is in the fork's filter" ||
  fail "the unit test is in the fork's filter" \
    "scripts/engine-unit-tests.sh's FILTER has no ProbeWaitTest.*"

[ "$FAILED" -eq 0 ] && echo "PASS: a probe the browser never answers stops the wait"
[ "$FAILED" -eq 0 ]
