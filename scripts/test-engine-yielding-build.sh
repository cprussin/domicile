#!/usr/bin/env bash
# Asserts `engine-yielding-build.sh` yields the compile slot to waiting jobs.
#
# The production engine build takes hours on a machine with one compile slot.
# The wrapper stops the build while another job waits, hands over the slot,
# takes it back and restarts the build, which resumes incrementally.
#
# Checks that the build's outcome survives: it finishes, fails, or is
# interrupted and then finishes.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
YIELD_SH="$ROOT/.github/scripts/engine-yielding-build.sh"
SLOT_SH="$ROOT/.github/scripts/engine-compile-slot.sh"
NODE_SH="$ROOT/.github/scripts/engine-render-node-lock.sh"
[ -x "$YIELD_SH" ] || { echo "no $YIELD_SH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export DOMICILE_COMPILE_SLOT="$WORK/slot"
export DOMICILE_COMPILE_SLOT_POLL=0.1 DOMICILE_COMPILE_SLOT_WAIT=10
export DOMICILE_YIELD_POLL=0.1
export DOMICILE_RENDER_NODE_LOCK="$WORK/node" DOMICILE_RENDER_NODE_NOISE="$WORK/noise"
export DOMICILE_RENDER_NODE_POLL=1 DOMICILE_RENDER_NODE_NOISE_BEAT=1
# The production build and the waiter run as separate jobs on separate
# runners. With a shared RUNNER_NAME, the waiter would clear the build's hold as
# a dead job's (see engine-compile-slot.sh).
unset RUNNER_NAME

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
expect() { # what, want, got
  if [ "$3" = "$2" ]; then ok "$1"; else
    fail "$1" "wanted: $2
    got:    $3"
  fi
}
contains() { # what, needle, haystack
  case "$3" in
    (*"$2"*) ok "$1" ;;
    (*) fail "$1" "expected to mention: $2
    said: $3" ;;
  esac
}

# A build that logs each start, sleeps, and exits with <status>.
BUILD="$WORK/build"
cat >"$BUILD" <<'EOF'
#!/usr/bin/env bash
echo started >>"$1"
sleep "$2"
exit "$3"
EOF
chmod +x "$BUILD"
starts() { wc -l <"$1" | tr -d ' '; }

# --- nobody waiting ----------------------------------------------------------

"$SLOT_SH" take prod >/dev/null
"$YIELD_SH" prod -- "$BUILD" "$WORK/ran-once" 0.3 0 >/dev/null 2>&1
expect "a build nobody waits on finishes" 0 "$?"
expect "having started once" 1 "$(starts "$WORK/ran-once")"
contains "and still holds the slot" "'prod'" "$("$SLOT_SH" who)"

"$YIELD_SH" prod -- "$BUILD" "$WORK/ran-failing" 0.1 3 >/dev/null 2>&1
expect "a build that fails fails with its own status" 3 "$?"
expect "without being started again" 1 "$(starts "$WORK/ran-failing")"

# --- somebody waiting ---------------------------------------------------------

# A pull request takes the slot mid-build, compiles briefly, and drops it.
( sleep 0.5
  "$SLOT_SH" take pr >/dev/null
  sleep 0.5
  "$SLOT_SH" drop pr >/dev/null ) &
out="$("$YIELD_SH" prod -- "$BUILD" "$WORK/ran-yielding" 2 0 2>&1)"
status=$?
wait
expect "a build that yielded still finishes" 0 "$status"
expect "having been started again" 2 "$(starts "$WORK/ran-yielding")"
contains "and says whom it stepped aside for" "'pr'" "$out"
contains "and it holds the slot again" "'prod'" "$("$SLOT_SH" who)"

# A pull request's latency guard waits for the noise to stop. The build stops,
# and restarts once the guard has measured and released the machine.
( sleep 0.5
  DOMICILE_RENDER_NODE_QUIET_WAIT=10 "$NODE_SH" quiet latency >/dev/null 2>&1
  sleep 0.5
  "$NODE_SH" drop latency >/dev/null 2>&1 ) &
out="$("$YIELD_SH" prod -- "$NODE_SH" noisy prod -- \
  "$BUILD" "$WORK/ran-quiet" 3 0 2>&1)"
status=$?
wait
expect "a build that stepped aside for a measurement still finishes" 0 "$status"
expect "having been started again" 2 "$(starts "$WORK/ran-quiet")"
contains "and says whom it stepped aside for" "'latency'" "$out"

# An interrupted build leaves no process running.
if pgrep -f "$WORK/ran-yielding" >/dev/null; then
  fail "the interrupted build is not left running" "$(pgrep -af "$WORK/ran-yielding")"
else
  ok "the interrupted build is not left running"
fi

"$SLOT_SH" drop prod >/dev/null

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
