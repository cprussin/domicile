# Verdict helpers for the e2e scripts. See
# packages/e2e-harness/docs/SCRIPT-VERDICTS.md.
#
# Sourced so `packages/e2e-harness/src/verdicts.test.ts` covers the one copy.
# The helpers check whether the compositor is alive when they fire, so a
# compositor crash is never reported as a harness fault.
#
# The helpers exit. In a pipeline or command substitution that ends only the
# subshell, so call them directly.

# Exits 99 if no pid was passed. `kill -0 ""` fails, so an empty pid would
# otherwise read as a dead compositor.
_pid_or_bail() {
  if [ -z "$1" ]; then
    echo "ERROR: no compositor pid was passed to $2."
    echo "  That is this script's own bookkeeping, not the compositor."
    exit 99
  fi
}

# Exits 99 for a failure in the script's own machinery. If the compositor has
# exited, fails it instead (exit 1), since a crash is a verdict on the code.
#
#   harness_fault <pid> <what it was doing> <line>...
harness_fault() {
  local pid="${1:-}" doing="${2:-}"
  shift 2 2>/dev/null || true
  if [ -z "$doing" ]; then
    echo "ERROR: harness_fault was not told what the compositor was doing."
    echo "  That is this script's own bookkeeping, not the compositor."
    exit 99
  fi
  _pid_or_bail "$pid" "harness_fault"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "FAIL: the compositor exited before $doing."
    echo "  Not this script's harness — a compositor that is gone advertised"
    echo "  nothing because it is gone. Its own assertions are the first place"
    echo "  to look."
    exit 1
  fi
  for line in "$@"; do echo "$line"; done
  echo "  That is this script's harness, not the compositor's advertising."
  exit 99
}

# Fails the compositor with the given lines. If it has exited, reports that
# instead, since the lines describe a running compositor.
#
#   compositor_verdict <pid> <line>...
compositor_verdict() {
  local pid="${1:-}"
  shift 2>/dev/null || true
  _pid_or_bail "$pid" "compositor_verdict"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "FAIL: the compositor exited."
    echo "  Not what the lines below would have said — a compositor that is"
    echo "  gone advertised nothing because it is gone. Its own assertions are"
    echo "  the first place to look."
    exit 1
  fi
  for line in "$@"; do echo "$line"; done
  exit 1
}

# Returns non-zero unless the pass count is N. Use as the first arm of each
# later decision, so a skipped earlier check cannot lead to a verdict on the
# compositor.
#
#   if ! after 1; then harness_fault …
after() {
  if [ "$PASSED" -ne "$1" ]; then
    echo "  ($1 checks should have passed before this one; $PASSED did.)"
    return 1
  fi
}

# Records a passing decision for `after` and `every_check_ran`.
PASSED=0
passed() {
  echo "PASS: $1"
  PASSED=$((PASSED + 1))
}

# Fails unless the pass count is N. Call it last, so a decision that was
# skipped instead of passed fails the run. A wrong count says nothing about the
# compositor, so it exits 1 directly instead of using a verdict helper.
#
#   every_check_ran <how many>
every_check_ran() {
  if [ "$PASSED" -ne "$1" ]; then
    echo "FAIL: $PASSED of $1 checks reached a verdict."
    if [ "$PASSED" -lt "$1" ]; then
      echo "  A decision was skipped rather than passed, which means something"
      echo "  in this script's own machinery did not run."
    else
      echo "  More decisions passed than this script has, so the count and the"
      echo "  decisions have drifted apart."
    fi
    echo "  Nothing here is a statement about the compositor."
    exit 1
  fi
}
