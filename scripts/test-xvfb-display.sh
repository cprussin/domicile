#!/usr/bin/env bash
# How an e2e script gets a display, and what it says when it cannot.
#
# The unit is `ensure_display`, which is the whole of that decision: take the
# display the caller already has, or start a server and say why if one will not
# start. Neither needs a real X server — a stub `Xvfb` on `PATH` reproduces
# every outcome, which is the point of the seam.
#
# Every case runs it the way the callers do: called in this shell, not inside
# `$( )`. That is not a detail. The function exports `DISPLAY` and hands back a
# pid in `XVFB`, and both die with the subshell if it is called in one — so a
# fixture built the other way cannot see the two things the callers depend on,
# and its output is what a subshell said rather than what the caller got.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"

FAILED=0

expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

ok() { printf '  ok    %s\n' "$1"; }
no() {
  printf '  FAIL  %s\n' "$1"
  [ "$#" -gt 1 ] && printf '    %s\n' "$2"
  FAILED=$((FAILED + 1))
}

# A stub `Xvfb` ahead of any real one, written per case. `$1` is its body, and
# it is what makes every outcome reachable in a second without an X server —
# including the two that a real Xvfb only produces on a broken machine.
STUB_DIR="$(mktemp -d)"
PATH="$STUB_DIR:$PATH"
export PATH
stub_xvfb() {
  cat >"$STUB_DIR/Xvfb" <<EOF
#!/usr/bin/env bash
$1
EOF
  chmod +x "$STUB_DIR/Xvfb"
}
# A stub that stays up `exec`s, so the pid `ensure_display` hands back *is* the
# thing pretending to be the server. Without it the pid is a wrapping shell,
# the caller's `kill` ends the wrapper and leaves the process it was
# demonstrating running — and in production `XVFB` is the `Xvfb` process
# itself. The same lesson as the `$( )` one above, a level down: the fixture
# has to be the caller's shape or it demonstrates something else.

# What it said, kept out of `$( )` so the call itself stays in this shell.
SAID="$(mktemp)"
STATUS=0
ensure_display_here() {
  STATUS=0
  ensure_display "$1" "$2" >"$SAID" || STATUS=$?
}
said() { cat "$SAID"; }

echo "== ensure_display =="

# The display the caller already made is the one to use. This is the case the
# e2e scripts were getting wrong: `check.sh` gates them on $DISPLAY and they
# each started a second server anyway, so a run where the outer server came up
# and the inner one did not failed for a reason nothing reported.
stub_xvfb 'echo "a second server was started" >&2; exit 1'
DISPLAY=":41"
XVFB="not-touched"
ensure_display_here 800x600x24 2
expect "the caller's display is taken as it is" ":41" "$DISPLAY"
expect "and no second server is started for it" "" "$XVFB"
# Every caller is `ensure_display … || exit 1`, so a success that reports
# failure aborts all four scripts on a machine that is perfectly healthy.
expect "and it reports success" "0" "$STATUS"

# Nothing to inherit: start one, and let the server pick the number. A fixed
# one collides with whatever a previous run left behind, and a socket with no
# server behind it reads as a live display to anything that tests for it.
unset DISPLAY
stub_xvfb 'printf "42\n" >&3; exec sleep 30'
ensure_display_here 800x600x24 5
expect "a server that names a display is used" ":42" "${DISPLAY:-}"
expect "and starting one reports success" "0" "$STATUS"
# Read from a *child*, because every caller's display is for a child: Electron
# is the one that has to see it. A `DISPLAY` set without being exported passes
# an assertion made in this shell and gives the callers nothing.
expect "and a child of the caller sees it" ":42" \
  "$(bash -c 'echo "${DISPLAY-unset}"')"
if [ -n "${XVFB:-}" ] && kill -0 "$XVFB" 2>/dev/null; then
  ok "and its pid comes back, for the caller to kill"
else
  no "and its pid comes back, for the caller to kill"
fi
kill "${XVFB:-}" 2>/dev/null

# The failure the whole thing exists for: a reason, in the server's own words,
# rather than `Xvfb never came up` — which is the question restated.
unset DISPLAY
stub_xvfb 'echo "(EE) Cannot establish any listening sockets" >&2; exit 1'
ensure_display_here 800x600x24 5
expect "a server that dies is quoted, with its status" \
  "FAIL: no display — Xvfb exited 1 — it said: (EE) Cannot establish any listening sockets" \
  "$(said)"
expect "and a failure is one the caller cannot miss" "1" "$STATUS"

# And it says so at once. Watching only the clock reaches the same sentence for
# a server that died — by way of the whole deadline, on a machine where nothing
# is going to change in the meantime. The wording cannot tell those apart, so
# the time is what pins it: the deadline here is thirty seconds and a death
# must not cost them.
unset DISPLAY
stub_xvfb 'exit 1'
SECONDS=0
ensure_display_here 800x600x24 30
if [ "$SECONDS" -lt 5 ]; then
  ok "and it says so when the server dies, not when the deadline ends"
else
  no "and it says so when the server dies, not when the deadline ends" \
    "took ${SECONDS}s of a 30s deadline"
fi

# And the other half of the diagnosis: a server that is alive and simply never
# ready. Told apart from the one above, because the two need different answers
# from whoever reads the log.
unset DISPLAY
stub_xvfb 'exec sleep 30'
SECONDS=0
ensure_display_here 800x600x24 3
expect "a server that never names a display names the deadline instead" \
  "FAIL: no display — Xvfb named no display in 3s" \
  "$(said)"
# The deadline it names has to be the one it waited. A loop that counts ticks
# for seconds still prints `3s`, having waited a third of one — and `check.sh`
# records a CI run that failed because its deadline was *too short*, so a
# verdict that overstates what it waited is the shape with history here.
if [ "$SECONDS" -ge 2 ]; then
  ok "and it waited the deadline it names"
else
  no "and it waited the deadline it names" "gave up after ${SECONDS}s of 3"
fi
# Still ours, and still running: the caller's trap is what ends it, and it can
# only do that with a pid. By pid rather than by pattern, for the reason
# `e2e-electron.sh` gives: a `pkill -f` matching `sleep 30` would also take out
# a bystander, and `test-xvfb-verdict.sh` in this very group runs one.
if [ -n "${XVFB:-}" ] && kill -0 "$XVFB" 2>/dev/null; then
  ok "and a server that is merely slow is left for the caller to kill"
else
  no "and a server that is merely slow is left for the caller to kill"
fi
kill "${XVFB:-}" 2>/dev/null

rm -rf "$STUB_DIR" "$SAID"

[ "$FAILED" -eq 0 ]
