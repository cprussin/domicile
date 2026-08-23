# Verdict machinery for the e2e scripts.
#
# Sourced rather than copied, so the one behaviour that matters here — a
# compositor that died is never reported as this suite's own fault — is defined
# once and tested once. `packages/e2e-harness/src/verdicts.test.ts` drives this
# file directly; a copy in a script would be a copy the test does not cover.
#
# Both helpers ask the same question at the instant they fire, rather than
# relying on a check placed beside them. A placement can be got wrong, and this
# one has been repeatedly, usually while fixing the previous instance.
#
# Note that `exit 99` is not a verdict class anything else in the repo knows
# about: `check.sh` counts every non-zero, non-77 status as failed, so 99 and 1
# reach it identically. The difference is the prose a human then reads, which
# is exactly why the wrong one is expensive and nothing catches it.
#
# Both helpers exit, which is what lets a caller put them in every arm of a
# diagnosis and have none of the arms reachable by falling through another.
# That holds only where they are called directly: in a pipeline or a command
# substitution the `exit` ends the subshell and the script carries on.
#
# Arms alone are not enough, because a script is several decisions in sequence
# and a later one's verdict is only about the compositor if the earlier ones
# held. So a passing decision says so through `passed`, and the script ends by
# checking the count with `every_check_ran`: a bail that turned into a no-op
# leaves control in the next decision with its premise unestablished, and the
# count is what catches that at the end instead of letting the run go green.

# The pid a helper was handed, or a bail about the script's own bookkeeping.
#
# `kill -0 ""` fails, so an empty pid would otherwise report the compositor as
# gone — a harness fault dressed as the loudest possible verdict on the code,
# which is the one thing this file exists to prevent.
_pid_or_bail() {
  if [ -z "$1" ]; then
    echo "ERROR: no compositor pid was passed to $2."
    echo "  That is this script's own bookkeeping, not the compositor."
    exit 99
  fi
}

# Bailing out because *this script's* machinery failed, rather than because
# the compositor did anything wrong.
#
# It re-checks the compositor first, and that is the whole point: a compositor
# that died is not a harness fault, it is the loudest possible verdict on the
# code, and calling it ours buries the real failure. `set_output`'s `assert!`
# makes that reachable — deleting a `follows_the_window` guard aborts the
# process rather than advertising the wrong thing.
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

# Failing the compositor, with the right diagnosis in both cases.
#
# The counterpart to `harness_fault` and the reason it exists: a compositor
# that *aborted* did not merely fail to log something, and the lines a script
# passes here were written about a machine that was still running. Without this
# a script that has ruled out its own machinery still has one way left to be
# wrong about which failure it is looking at.
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

# Whether every decision before this one reached a verdict.
#
# The first arm of every decision but the first, because arms only order the
# arms *within* one decision. A script is several in sequence and a later
# verdict about the compositor is only about the compositor if the earlier
# ones held — so a bail that no-ops in decision 1 must not leave decision 2
# free to convict. Failing this, control falls out of that decision too, and
# `every_check_ran` is what turns the resulting silence into a failure.
#
# Says both numbers itself when it fails, so no caller spells one of them a
# second time and gets them out of step.
#
#   if ! after 1; then harness_fault …
after() {
  if [ "$PASSED" -ne "$1" ]; then
    echo "  ($1 checks should have passed before this one; $PASSED did.)"
    return 1
  fi
}

# One decision passed. Counted, because the count is what the end checks.
PASSED=0
passed() {
  echo "PASS: $1"
  PASSED=$((PASSED + 1))
}

# Every decision reached its own verdict, or this run proves nothing.
#
# The last line of a script, and the answer to the one thing arms cannot fix:
# a bail that no-ops does not stop the script, it just leaves that decision
# undecided — and a run that skipped a decision is not a run that passed it.
# Its failure path is a bare `exit 1` rather than a call to either verdict
# helper — a count that came out wrong is not a statement about the compositor
# and must not be routed through something that asks about one. It is not
# otherwise independent of this file: it lives here and reads `PASSED`, which
# only `passed` sets. A script that fails to source this at all is caught by
# `verdicts.ts`'s third rule, not by the count.
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
