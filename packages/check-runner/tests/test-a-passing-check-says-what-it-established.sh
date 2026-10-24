#!/usr/bin/env bash
# Checks how `check-runner` reports each check.
#
# - A pass prints the check's `PASS:` lines under its `ok`. The runner keeps a
#   log only on failure, so without them a pass gives no evidence.
# - A failure keeps its whole log, and a failing cargo test's report reaches
#   the summary.
# - A skip reads as a skip, and one with no `SKIP:` reason fails.
# - The tally keeps its format, and a run that checked nothing fails.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$ROOT/bin/check-runner.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    ok "$1"
  else
    fail "$1" "wanted: $(printf '%q' "$2")  got: $(printf '%q' "$3")"
  fi
}

mkdir -p "$WORK/checks"
standin() { # name, body
  printf '#!/usr/bin/env bash\n%s\n' "$2" >"$WORK/checks/$1.sh"
  chmod +x "$WORK/checks/$1.sh"
}

# A guard and its control, with noise around them. The second `PASS:` is
# indented, as when a guard quotes a run's output.
standin check-1-says-what-it-established '
echo "starting the engine"
echo "PASS: the positive run found the window"
echo "a thousand lines of Chromium startup"
echo "  PASS: the control found nothing, as it must"'

# A typical check with `ok` lines and no `PASS:`.
standin check-2-says-nothing '
echo "  ok    something this check asserts"
echo "all ok"'

# Longer than the 100-line failure summary, so only the kept log has its first
# line. Its `PASS:` must not be printed as a verdict.
standin check-3-fails '
echo "PASS: an early run"
for n in $(seq 1 150); do echo "line $n"; done
exit 1'

# A skip after a `PASS:` line. Nothing it said may read as a pass.
standin check-4-cannot-run '
echo "PASS: a step before the one that needed a card"
echo "  SKIP: no card here"
exit 77'

# A failing `cargo test --no-fail-fast`: the failing binary's report is
# followed by more than the 100-line summary.
standin check-5-fails-a-test '
echo "running 2 tests"
echo "test it_works ... ok"
echo "test it_breaks ... FAILED"
echo
echo "failures:"
echo
echo "---- it_breaks stdout ----"
echo "thread '"'"'it_breaks'"'"' panicked at tests/it.rs:1:1:"
echo "the reason it broke"
echo
echo "failures:"
echo "    it_breaks"
echo
echo "test result: FAILED. 1 passed; 1 failed"
for n in $(seq 1 150); do echo "a later test binary, line $n"; done
exit 1'

# Unset DOMICILE_CHECK_STRICT, which CI exports, so skips stay skips.
check() { # env assignments...
  env -u DOMICILE_CHECK_STRICT -u DOMICILE_CHECK_ALLOW_SKIP "$@" \
    DOMICILE_CHECK_LOG_DIR="$WORK/logs" "$RUNNER" "$WORK"/checks/*.sh \
    >"$WORK/out" 2>&1
}

# Prints the indented lines under a check's verdict line.
under() { # check name
  awk -v name="$1" '
    found && !/^    / { exit }
    found { print }
    index($0, "  " name " ") == 1 { found = 1 }' "$WORK/out"
}

echo "check-runner, reporting its checks"

check
status=$?

expect "a run with a failure exits 1" "1" "$status"

expect "a passing check's PASS: lines are printed under its ok" \
  "$(printf '    PASS: the positive run found the window\n    PASS: the control found nothing, as it must')" \
  "$(under check-1-says-what-it-established)"

expect "its ok line is unchanged" "yes" \
  "$(grep -qE '^  check-1-says-what-it-established +ok$' "$WORK/out" && echo yes || echo no)"

expect "a passing check with no PASS: line adds nothing" "" \
  "$(under check-2-says-nothing)"

expect "and none of the rest of a passing check's log is printed" "no" \
  "$(grep -qE 'Chromium startup|all ok|something this check asserts' "$WORK/out" && echo yes || echo no)"

expect "a failing check is still FAILED, with no verdicts under it" "yes" \
  "$(grep -qE '^  check-3-fails +FAILED$' "$WORK/out" && [ -z "$(under check-3-fails)" ] &&
       echo yes || echo no)"

expect "and its whole log is kept" \
  "$(printf 'PASS: an early run\n'; seq 1 150 | sed 's/^/line /')" \
  "$(cat "$WORK/logs/domicile-check-logs/check-3-fails.log")"

expect "a failing cargo test's report is in the summary above the tail" \
  "$(printf -- "---- it_breaks stdout ----\nthread 'it_breaks' panicked at tests/it.rs:1:1:\nthe reason it broke\n\nfailures:\n    it_breaks\n\ntest result: FAILED. 1 passed; 1 failed")" \
  "$(awk '/^--- check-5-fails-a-test ---$/ { found = 1; next }
          found && /^a later test binary/ { exit }
          found { print }' "$WORK/out")"

expect "a skip still reads as a skip, with no verdicts under it" "yes" \
  "$(grep -qE '^  check-4-cannot-run +skipped \(no card here\)$' "$WORK/out" &&
     [ -z "$(under check-4-cannot-run)" ] && echo yes || echo no)"

expect "the tally keeps its format" "yes" \
  "$(grep -qxF '== 2 passed, 2 failed, 1 skipped ==' "$WORK/out" &&
     grep -qxF '  skipped: check-4-cannot-run — no card here' "$WORK/out" &&
       echo yes || echo no)"

check DOMICILE_CHECK_STRICT=1
expect "under DOMICILE_CHECK_STRICT a skip is a failure" "yes" \
  "$(grep -qE '^  check-4-cannot-run +FAILED \(no card here\)$' "$WORK/out" &&
     grep -qxF '== 2 passed, 3 failed, 0 skipped ==' "$WORK/out" &&
       echo yes || echo no)"

check DOMICILE_CHECK_STRICT=1 DOMICILE_CHECK_ALLOW_SKIP="other check-4-cannot-run"
expect "a skip DOMICILE_CHECK_ALLOW_SKIP names is still a skip" "yes" \
  "$(grep -qE '^  check-4-cannot-run +skipped, as expected here \(no card here\)$' "$WORK/out" &&
     echo yes || echo no)"

echo "check-runner, refusing a skip with no reason"

rm "$WORK"/checks/*.sh
standin check-6-skips-silently 'exit 77'
check
status=$?
expect "a skip with no SKIP: line fails" "yes" \
  "$(grep -qE '^  check-6-skips-silently +FAILED \(skipped without a SKIP: reason\)$' "$WORK/out" &&
     echo yes || echo no)"
expect "and fails the run" "1" "$status"

echo "check-runner, with nothing to check"

rm "$WORK"/checks/*.sh
env -u DOMICILE_CHECK_STRICT DOMICILE_CHECK_LOG_DIR="$WORK/logs" "$RUNNER" \
  >"$WORK/out" 2>&1
status=$?
expect "a run that checked nothing fails" "1" "$status"
expect "and says so" "yes" \
  "$(grep -qF 'nothing ran' "$WORK/out" && echo yes || echo no)"

echo "check-runner, with every check passing"

standin check-7-passes 'echo "PASS: it works"'
check
expect "a green run exits 0" "0" "$?"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
