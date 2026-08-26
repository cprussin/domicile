#!/usr/bin/env bash
# Prove the HiDPI chain end to end: a chrome that reports a 2x display makes a
# client draw at 2x, and the frame that comes back says so.
#
#   nix develop .#full -c ./scripts/e2e-hidpi.sh
#
# The chain has four links and each one is asserted separately, because a break
# in any of them looks the same from a screenshot — slightly soft text:
#
#   1. the chrome reports its devicePixelRatio
#   2. the compositor advertises it as the wl_output scale
#   3. a scale-aware client redraws at that scale and says so (set_buffer_scale)
#   4. the frame reaching the chrome carries the scale, and the *logical* size
#      the element is laid out at is the buffer's pixels divided by it
#
# Link 4 is the one worth the most: get it wrong and the pixels are right while
# every pointer coordinate is off by a factor of the scale.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
# 1, not 77. A client this repo builds and cannot build is a broken tree, which
# is a failure; 77 is for what the *machine* is missing, and this needs nothing
# the machine has to supply.
build_test_client || exit 1
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
BIN="$ROOT/target/debug/domicile-compositor"
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree. Incremental and near-free when there is
# nothing to do.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
# 77 is skipped, which is what a missing dependency is: a check that did not
# run says nothing, and a check that ran and blamed the compositor for a client
# it could not start says something false.
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: bun runs the mock chrome, which is what reports the 2x density."
  exit 77
}

export XDG_RUNTIME_DIR="/tmp/domicile-rt-hidpi"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
CHROME="$(mktemp)"; COMPLOG="$(mktemp)"; CLILOG="$(mktemp)"
MOCK=""; CLI=""

# `debug` because the arm below reads the frames the compositor received: a
# chrome that connected and sent no density looks exactly like a compositor
# that ignored one, and only the log tells them apart.
RUST_LOG="info,domicile_compositor=debug" \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
# `wait` after the kill so bash reaps the jobs quietly; without it it reports
# "Killed" on stderr at exit, which reads like a failure in a passing run.
cleanup() {
  kill -9 "$COMP" $MOCK $CLI 2>/dev/null
  wait 2>/dev/null
  rm -f "$CHROME" "$COMPLOG" "$CLILOG"
}
trap cleanup EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

# The compositor colours its log; these greps read it as plain text.
plain() { sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG"; }

# A verdict on the compositor, through the helper that asks whether it is still
# running first: a compositor that aborted did not "fail to advertise", it is
# gone, and saying the former buries the latter.
#
# Only for the checks that have already established the harness did its part —
# a chrome that never connected and a client that never started both look like
# a compositor that advertised nothing, and each is asked about by name below.
fail() { compositor_verdict "$COMP" "FAIL: $1" "${@:2}"; }

# A chrome claiming a 2x display. Everything downstream follows from this one
# number, which is the point: nothing else in the tree is configured for HiDPI.
DOMICILE_CHROME_LISTEN_MS=20000 DOMICILE_CHROME_SOCK="$SOCK" DOMICILE_CHROME_DPR=2 \
  bun "$ROOT/packages/e2e-harness/src/mock-chrome.ts" >"$CHROME" 2>&1 &
MOCK=$!
# Both files, because the decision below reads both and two processes write
# them. The compositor's line says it acted on the density; the chrome's says
# the handshake it answered came back. Waiting only for the compositor's is
# what made this script fail in CI: the welcome was a moment behind it, the
# first arm fired, and the output it dumped to prove the chrome never
# handshook had the welcome in it. Bounded, so a chrome that genuinely never
# handshakes still reaches that arm with what it did produce.
#
# Not the first line the chrome writes, either. A connection is registered when
# it is accepted and answered when it says hello, so a broadcast in between
# reaches it ahead of its own handshake answer — which is why that answer
# carries the desktop as of when it is written. This waits for the line rather
# than for the file to be non-empty.
for _ in $(seq 1 200); do grep -q '"type":"welcome"' "$CHROME" && break; sleep 0.05; done
for _ in $(seq 1 200); do plain | grep -q "advertising output scale" && break; sleep 0.05; done

echo "== the scale the compositor advertised =="
plain | grep -oE "advertising output scale.*scale=[0-9]+" | head -1
# Arms, not a guard with the pass below it: a bail that turned into a no-op
# would otherwise drop past its own `if` and print PASS for a run that failed.
if ! grep -q '"type":"welcome"' "$CHROME"; then
  harness_fault "$COMP" "the mock chrome could complete its handshake" \
    "ERROR: the mock chrome never completed the handshake; its output was:" \
    "$(cat "$CHROME")"
elif plain | grep -q "unparseable chrome message"; then
  harness_fault "$COMP" "the compositor could read what the chrome sent" \
    "ERROR: the compositor could not parse a message from the chrome;" \
    "  the harness and the host disagree about the wire." \
    "$(plain | grep -m1 "unparseable chrome message")"
elif ! plain | grep -q "set_device_pixel_ratio"; then
  # The rung this script was missing. `mock-chrome.ts` sends a density only
  # when `DOMICILE_CHROME_DPR` is set, so a name spelled wrong here — or any
  # regression in the mock — leaves it unset with no complaint from anyone,
  # and the compositor then advertises scale 1 for the most boring reason
  # there is. Without this arm that is byte-identical to a compositor that
  # clamps the scale, which is the failure this whole script exists to catch.
  harness_fault "$COMP" "the chrome could report a density" \
    "ERROR: the chrome never sent a density to advertise." \
    "  DOMICILE_CHROME_DPR reached mock-chrome.ts unset or misspelled." \
    "  The compositor logged no set_device_pixel_ratio from it."
elif plain | grep -qE "advertising output scale.*[^_]scale=2"; then
  passed "a 2x chrome makes the compositor advertise output scale 2"
else
  fail "the compositor did not advertise scale 2 for a 2x chrome" \
       "$(plain | grep -aE 'WARN|ERROR|scale' | tail -5)"
fi

# `--trace` makes the client report the protocol it is handed and the requests
# it makes back, which is where every grep below reads. The client is
# scale-aware: it keeps each output's scale, and when `wl_surface.enter` says
# which screen it is on it sets a buffer scale to match and remakes its pixels
# at that density.
WAYLAND_DISPLAY=wayland-1 timeout 20 "$TEST_CLIENT" --title app --trace >"$CLILOG" 2>&1 &
CLI=$!
# The client's own log, which is what the decision below reads — not the
# frames reaching the chrome, which are a third process's account of a
# different thing. A client learns the scale from `wl_surface.enter`, so one
# that commits its first buffer before that arrives commits it at scale 1: the
# frame lands, the wait ends, and the redraw this decision is about has not
# happened yet. The verdict for that is "the client never set a buffer scale
# of 2", which is the one line here that would send someone into the
# compositor. Bounded, so a client that genuinely never redraws still reaches
# the `fail` below with the output events it did see.
for _ in $(seq 1 300); do
  grep -qE "wl_surface[#@][0-9]+\.set_buffer_scale\(2\)" "$CLILOG" && break
  sleep 0.1
done

echo "== what the client did about it =="
grep -oE "wl_surface[#@][0-9]+\.set_buffer_scale\([0-9]+\)" "$CLILOG" | head -1
if ! after 1; then
  harness_fault "$COMP" "the checks before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif ! grep -qE "wl_registry[#@][0-9]+\.global\([0-9]+, \"wl_output\"" "$CLILOG"; then
  harness_fault "$COMP" "the client could bind an output" \
    "ERROR: the client never saw a wl_output global; its log begins:" \
    "$(head -5 "$CLILOG")" \
    "  A client that could not start looks exactly like a client that" \
    "  ignored the scale it was given."
elif grep -qE "wl_surface[#@][0-9]+\.set_buffer_scale\(2\)" "$CLILOG"; then
  passed "the client redrew at buffer scale 2"
else
  fail "the client never set a buffer scale of 2" \
       "--- the output events it saw:" \
       "$(grep -aoE 'wl_output[#@][0-9]+\.(scale|done)\([0-9]*\)' "$CLILOG" | sort -u | tr '\n' ' ')" \
       "--- the last thing it did:" \
       "$(grep -aE '^\[[0-9:]+\.[0-9]+\]' "$CLILOG" | cut -c1-140 | tail -5)"
fi

# The mode, which is the other half of the same advertisement and the half a
# buffer scale cannot speak for. A mode is physical pixels, so raising the
# density has to raise it too — a scale left on the old mode is an
# `xdg_output.logical_size` of half the desktop, i.e. every client told the
# screen is half the size the chrome is laid out at.
#
# Derived from the log line above rather than hardcoded: the desktop's size is
# `compositor.nested_size`, which nothing else in this script pins, so a
# literal would make an unrelated change to that default fail here with a
# verdict that is false for the build it is describing.
LOGICAL_LINE="$(plain | grep -oE "advertising output scale width=[0-9]+ height=[0-9]+ scale=[0-9]+" | tail -1)"
LOG_W=$(sed 's/.*width=//; s/ .*//' <<<"$LOGICAL_LINE")
LOG_H=$(sed 's/.*height=//; s/ .*//' <<<"$LOGICAL_LINE")
echo "== the mode the client was advertised at that scale =="
grep -oE "wl_output[#@][0-9]+\.mode\([0-9]+, [0-9]+, [0-9]+, [0-9]+\)" "$CLILOG" | sort -u
if ! after 2; then
  harness_fault "$COMP" "the checks before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif [ -z "$LOG_W" ] || [ -z "$LOG_H" ]; then
  # This one is not a verdict, and its own text always said so: the grep is a
  # field *order*, not a fact about the compositor, so reordering the `info!`
  # above breaks this script and nothing else. Reading the log is this
  # script's job, and failing at it is this script's fault.
  harness_fault "$COMP" "this script could read the size out of the log" \
    "ERROR: no 'advertising output scale width=W height=H scale=S' line" \
    "  matched. That is this script's own reading of the log, not the mode." \
    "$(plain | grep -a 'advertising output scale' | tail -3)"
# Flags 3 is current|preferred. Computed in the arm rather than above the `if`,
# because it is only meaningful once the size was read — which is the arm above.
elif grep -qF "mode(3, $((LOG_W * 2)), $((LOG_H * 2))," "$CLILOG"; then
  passed "the mode is the logical size in physical pixels"
else
  fail "the current mode did not grow with the scale" \
       "${LOG_W}x${LOG_H} at scale 2 is a $((LOG_W * 2))x$((LOG_H * 2)) mode." \
       "Left at ${LOG_W}x${LOG_H}, every client computes a desktop half the" \
       "size the chrome is laid out at." \
       "--- the modes it was told:" \
       "$(grep -aoE 'wl_output[#@][0-9]+\.mode\([^)]*\)' "$CLILOG" | sort -u | tr '\n' ' ')"
fi

# Back to the chrome's file, because the two decisions below read it and the
# wait above is one process's word about another. The client's log says it
# redrew; that redraw still has to be committed, imported and broadcast before
# the chrome has written anything down about it, and without this the arms
# below read a file that has none of it yet. The pattern is the one the arm
# below asserts rather than any app_frame: a first buffer committed before the
# client knew the scale carries scale 1, and stopping on that frame is
# stopping before the answer. The `app_resized` the last decision pairs with
# the frame rides the same commit, broadcast ahead of it, so it is here once
# this line is.
for _ in $(seq 1 300); do
  grep -q '"type":"app_frame".*"scale":2' "$CHROME" && break
  sleep 0.1
done

echo "== the frame that reached the chrome =="
grep -oE '"type":"app_frame","app_id":"[^"]*","width":[0-9]+,"height":[0-9]+,"scale":[0-9]+' "$CHROME" | head -1
if ! after 3; then
  harness_fault "$COMP" "the checks before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif grep -q '"type":"app_frame".*"scale":2' "$CHROME"; then
  passed "the frame carries the scale it was drawn at"
else
  fail "the frame did not carry scale 2, so the chrome cannot size its canvas" \
       "$(grep -o '"type":"app_frame"[^}]*' "$CHROME" | tail -2)"
fi

# The payoff, and the one a screenshot cannot show: the logical size the chrome
# lays out and maps the pointer through is the buffer's pixels divided by the
# scale. Equal to the pixel dimensions would mean every pointer event lands at
# half the position it should.
echo "== logical size vs the buffer's pixels =="
FRAME=$(grep -oE '"type":"app_frame","app_id":"[^"]*","width":[0-9]+,"height":[0-9]+,"scale":[0-9]+' "$CHROME" | tail -1)
RESIZED=$(grep -oE '"type":"app_resized","app_id":"[^"]*","size":\[[0-9.]+,[0-9.]+\]' "$CHROME" | tail -1)
echo "  frame:   $FRAME"
echo "  resized: $RESIZED"
PIXEL_W=$(sed 's/.*"width"://; s/,.*//' <<<"$FRAME")
LOGICAL_W=$(sed 's/.*"size":\[//; s/[.,].*//' <<<"$RESIZED")
if ! after 4; then
  harness_fault "$COMP" "the checks before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif [ -z "$PIXEL_W" ] || [ -z "$LOGICAL_W" ]; then
  fail "the chrome never saw both an app_frame and an app_resized" \
       "$(grep -oE '"type":"[a-z_]+"' "$CHROME" | sort | uniq -c | tr '\n' ' ')"
elif [ "$LOGICAL_W" -lt "$PIXEL_W" ]; then
  passed "$PIXEL_W device pixels reported as $LOGICAL_W logical units"
else
  fail "the reported size is the buffer's pixels, not logical units" \
       "buffer width $PIXEL_W, reported width $LOGICAL_W — every pointer" \
       "coordinate would be off by the scale."
fi

every_check_ran 5
