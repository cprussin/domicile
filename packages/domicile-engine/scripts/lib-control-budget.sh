#!/usr/bin/env bash
# Sets how long a control waits for an event that must not happen.
#
#   . "$SCRIPTS/lib-control-budget.sh"
#   budget_note client-window 4      # the guard saw its signal after 4s
#   budget_for client-window 60      # how long its control should wait
#
# A guard stops when it sees its signal; its control must wait out the full
# timeout. The guard and control run back to back on the same build and
# machine, so the guard's time is a good measure of how long the control must
# watch. A multiple of it scales with machine speed, unlike a fixed constant.
#
# Each rule below prevents a control from stopping too early, and has a case
# in `scripts/test-control-budget.sh`:
#
#   - no note: the control waits its full budget (e.g. run alone, or the
#     guard failed);
#   - never longer than the full budget;
#   - a floor, so a 200ms guard does not give an 800ms control;
#   - the note must be recent: runners are not ephemeral, so /tmp can hold a
#     note from an earlier job.

# The note lives in /tmp, not $TMPDIR. Each `nix develop` invocation sets a
# fresh $TMPDIR (src/nix/develop.cc, makeRcScript), and some callers
# (`pinned-engine.yml`, `engine-release.yml`, manual runs) start the guard and
# control in separate invocations. /tmp is shared by all steps of a job on the
# runner. `engine.yml` empties this directory at the start of a run, and the
# age check below rejects notes from earlier jobs.
DOMICILE_CONTROL_BUDGET_DIR="${DOMICILE_CONTROL_BUDGET_DIR:-/tmp/domicile-control-budgets}"

# Control budget = guard time x MULTIPLE, at least FLOOR seconds.
DOMICILE_CONTROL_BUDGET_MULTIPLE="${DOMICILE_CONTROL_BUDGET_MULTIPLE:-4}"
DOMICILE_CONTROL_BUDGET_FLOOR="${DOMICILE_CONTROL_BUDGET_FLOOR:-10}"
# Notes older than this are from another job. Ten minutes exceeds any
# guard-and-control pair in engine.yml and is shorter than the gap between
# jobs.
DOMICILE_CONTROL_BUDGET_MAX_AGE="${DOMICILE_CONTROL_BUDGET_MAX_AGE:-600}"

# Logs each decision to stderr, so a silent fallback to the full budget is
# visible in the step log.
budget_said() { printf 'control budget: %s\n' "$*" >&2; }

# Records that the guard saw its signal after $2 seconds. Call only on
# success: a timed-out guard measured its timeout, not the system.
#
# The file holds the seconds, then the time written. The timestamp is in the
# file, not the mtime, so this needs only `date` and `printf`; the runner's
# PATH may lack `stat` and `find` variants.
budget_note() { # $1 name, $2 seconds
  local file="$DOMICILE_CONTROL_BUDGET_DIR/$1"
  mkdir -p "$DOMICILE_CONTROL_BUDGET_DIR" 2>/dev/null || {
    budget_said "$1: cannot make $DOMICILE_CONTROL_BUDGET_DIR, so its control" \
      "will get no measurement and spend its full budget"
    return 0
  }
  printf '%s\n%s\n' "$2" "$(date +%s)" >"$file" 2>/dev/null || {
    budget_said "$1: cannot write $file, so its control will get no" \
      "measurement and spend its full budget"
    return 0
  }
  budget_said "$1: the guard took ${2}s, written down in $file"
}

# Prints how many seconds the control should wait, given full budget $2.
# Never fails: any problem falls back to the full budget.
budget_for() { # $1 name, $2 full budget in seconds
  local file noted written now budget
  file="$DOMICILE_CONTROL_BUDGET_DIR/$1"

  [ -f "$file" ] || {
    budget_said "$1: no note at $file, so nothing measured this and the" \
      "control spends its full ${2}s"
    printf '%s\n' "$2"
    return 0
  }

  noted="$(sed -n '1p' "$file" 2>/dev/null)"
  written="$(sed -n '2p' "$file" 2>/dev/null)"

  # Validate both fields before using either, so a truncated note falls back
  # to the full budget.
  case "$noted" in
    (''|*[!0-9]*)
      budget_said "$1: the note at $file reads '$noted' rather than a number," \
        "so the control spends its full ${2}s"
      printf '%s\n' "$2"
      return 0 ;;
  esac
  case "$written" in
    (''|*[!0-9]*)
      budget_said "$1: the note at $file was taken at '$written' rather than a" \
        "time, so the control spends its full ${2}s"
      printf '%s\n' "$2"
      return 0 ;;
  esac

  # Reject notes from earlier jobs. A clock that went backwards gives a
  # negative age, which is also rejected.
  now="$(date +%s)"
  case "$now" in
    (''|*[!0-9]*)
      budget_said "$1: the clock reads '$now', so the note cannot be dated and" \
        "the control spends its full ${2}s"
      printf '%s\n' "$2"
      return 0 ;;
  esac
  [ "$((now - written))" -ge 0 ] &&
    [ "$((now - written))" -le "$DOMICILE_CONTROL_BUDGET_MAX_AGE" ] || {
    budget_said "$1: the note at $file is $((now - written))s old, which is" \
      "another job's, so the control spends its full ${2}s"
    printf '%s\n' "$2"
    return 0
  }

  budget=$((noted * DOMICILE_CONTROL_BUDGET_MULTIPLE))
  [ "$budget" -ge "$DOMICILE_CONTROL_BUDGET_FLOOR" ] ||
    budget="$DOMICILE_CONTROL_BUDGET_FLOOR"
  [ "$budget" -le "$2" ] || budget="$2"
  budget_said "$1: the guard took ${noted}s" \
    "${DOMICILE_CONTROL_BUDGET_MULTIPLE}x that is" \
    "$((noted * DOMICILE_CONTROL_BUDGET_MULTIPLE))s," \
    "floor ${DOMICILE_CONTROL_BUDGET_FLOOR}s and ceiling ${2}s," \
    "so the control waits ${budget}s"
  printf '%s\n' "$budget"
}
