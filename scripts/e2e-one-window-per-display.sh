#!/usr/bin/env bash
# Is a window told about the screen it is *on*, and not about the other one?
#
#   nix develop .#full -c ./scripts/e2e-one-window-per-display.sh
#
# `tests/outputs.rs` asserts a client is told both displays exist and that
# an unplaced surface enters both — which is the fallback, and was all there
# was to assert while every surface entered every output. This is the rule:
# once the chrome has placed a window, the client is told the one screen it is
# over, and told it has left the other.
#
# Every half is unit-tested — `Portal::bounds` squares off a placement,
# `Screens::entered_by` decides which outputs it touches — and neither says a
# running compositor sends `wl_surface.enter` and `leave` to a real client when
# a real chrome places it. Making `entered_by` return every output
# unconditionally, which is the whole feature reverted, passes every other
# check in this suite.
#
# Needs no display. Needs a chrome, because a placement is the only thing that
# narrows the set and only a chrome can send one.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
# 1, not 77. A client this repo builds and cannot build is a broken tree, which
# is a failure; 77 is for what the *machine* is missing, and this needs nothing
# the machine has to supply.
build_test_client || exit 1
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: bun runs the chrome that places the windows; without one nothing narrows the set."
  exit 77
}

export XDG_RUNTIME_DIR="/tmp/domicile-rt-one-window-per-display"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
CONF="$(mktemp)"; FIRST="$(mktemp)"; SECOND="$(mktemp)"
CHROME="$(mktemp)"; COMPLOG="$(mktemp)"
COMP=""; ONE=""; TWO=""

# Side by side, and the right one at twice the density — so a client that was
# told the wrong screen would also be drawing at the wrong scale, which is what
# the rule is for.
cat >"$CONF" <<'JSON'
{
  "output": {
    "displays": [
      {
        "name": "left",
        "size": [
          1920,
          1080
        ]
      },
      {
        "name": "right",
        "position": [
          1920,
          0
        ],
        "size": [
          2560,
          1440
        ],
        "scale": 2
      }
    ]
  }
}
JSON

SOCK="$XDG_RUNTIME_DIR/c.sock"
RUST_LOG="info,domicile_compositor=debug" \
  "$BIN" --session "$SOCK.session" --config "$CONF" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
cleanup() {
  kill -9 "$COMP" "$ONE" "$TWO" 2>/dev/null; wait 2>/dev/null
  rm -f "$CONF" "$FIRST" "$SECOND" "$CHROME" "$COMPLOG"
}
trap cleanup EXIT

# Verdict machinery, shared so that a test can drive it — see
# `packages/e2e-harness/src/verdicts.test.ts`.
. "$ROOT/scripts/lib/harness.sh"

for _ in $(seq 1 200); do
  [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break
  sleep 0.05
done

# The screens each client's surface is on *now*: every output it entered and
# has not since left, named by where that output sits on the desktop rather
# than by the object id, which is per-connection and means nothing across two
# logs.
#
# Both events matter and each is dropped by its own one-line mutation. Counting
# enters alone passes a compositor that never narrows anything, since every
# surface enters every output on map; reading the last event alone passes one
# that leaves a screen it never entered.
screens_of() {
  awk '
    match($0, /wl_output[#@][0-9]+\.geometry\(-?[0-9]+/) {
      field = substr($0, RSTART, RLENGTH)
      sub(/\.geometry\(/, " ", field)
      split(field, parts, " ")
      sub(/wl_output[#@]/, "", parts[1])
      at[parts[1]] = parts[2]
    }
    match($0, /wl_surface[#@][0-9]+\.(enter|leave)\(wl_output[#@][0-9]+\)/) {
      event = substr($0, RSTART, RLENGTH)
      surface = event
      sub(/^wl_surface[#@]/, "", surface)
      sub(/\..*$/, "", surface)
      output = event
      sub(/.*wl_output[#@]/, "", output)
      sub(/\)$/, "", output)
      # The window, and not whatever else the client has. A popup is entered
      # and left too now, and keyed on the output alone a menu closing on the
      # right-hand screen would erase the *window*'"'"'s membership of it — a
      # wrong answer here reaching `compositor_verdict`, which blames the
      # compositor for a bug in this awk. The toplevel is the first surface
      # entered onto anything: a client maps its window before it can hang a
      # menu off one.
      if (window == "") { window = surface }
      if (surface == window) {
        if (event ~ /\.enter\(/) { on[output] = 1 } else { delete on[output] }
      }
    }
    END {
      for (output in on) { print (output in at) ? at[output] : "unknown" }
    }
  ' "$1" | sort -n | tr '\n' ' ' | sed 's/ $//'
}

echo "== two clients, one placed on each screen =="
# The clients outlive the poll budgets so a slow machine fails on what a client
# was told rather than on the client being killed mid-answer.
WAYLAND_DISPLAY=wayland-1 timeout 30 "$TEST_CLIENT" --title left --trace >"$FIRST" 2>&1 &
ONE=$!
for _ in $(seq 1 100); do
  [ "$(grep -c "toplevel mapped" "$COMPLOG")" -ge 1 ] && break
  sleep 0.1
done
WAYLAND_DISPLAY=wayland-1 timeout 30 "$TEST_CLIENT" --title right --trace >"$SECOND" 2>&1 &
TWO=$!
for _ in $(seq 1 100); do
  [ "$(grep -c "toplevel mapped" "$COMPLOG")" -ge 2 ] && break
  sleep 0.1
done

# One at a time and in this order, because the probe places by arrival: the
# first window it is told about goes on the left and the second on the right,
# and which client that is has to be knowable from here.
DOMICILE_CHROME_SOCK="$SOCK" DOMICILE_CHROME_LISTEN_MS=4000 \
  bun "$ROOT/packages/e2e-harness/src/one-window-per-display-probe.ts" >"$CHROME" 2>&1

# Wait for the *narrowing*, not for anything at all to have arrived. Both
# clients enter both screens on map, before there is a portal to place them by,
# so a poll that stops as soon as `screens_of` says something stops on the
# first iteration every time and waits for nothing — leaving the probe's listen
# window as the only real wait, and a `leave` that lands after it as a
# compositor FAIL that is really a race in this script.
#
# One screen each is what being told is: a window on two of two has not been
# narrowed, and a window on none has lost the fallback. Bounded, so a
# compositor that never narrows reaches the verdict below with what it actually
# did rather than hanging here.
for _ in $(seq 1 60); do
  [ "$(screens_of "$FIRST" | wc -w)" = 1 ] && [ "$(screens_of "$SECOND" | wc -w)" = 1 ] && break
  sleep 0.1
done

FIRST_ON="$(screens_of "$FIRST")"
SECOND_ON="$(screens_of "$SECOND")"
echo "the first client is on screens at x: ${FIRST_ON:-none}"
echo "the second client is on screens at x: ${SECOND_ON:-none}"
echo "$(cat "$CHROME")"

# Before any verdict: a chrome that never placed anything leaves both clients
# on every output, which is the fallback behaving correctly and would be
# reported as the rule being broken.
if [ "$(grep -c "^placed " "$CHROME")" -ne 2 ]; then
  harness_fault "$COMP" "the chrome placed both windows" \
    "ERROR: the chrome placed $(grep -c "^placed " "$CHROME") of 2 windows; it said:" \
    "$(cat "$CHROME")"
elif [ "$FIRST_ON" = "0" ]; then
  passed "the window on the left screen is told the left screen, and only that"
else
  compositor_verdict "$COMP" \
    "FAIL: the window placed on the left screen is on screens at x '${FIRST_ON:-none}'" \
    "  Expected '0'. A window told about a screen it is not on is a client" \
    "  free to draw at that screen's density; told about none, a toolkit that" \
    "  scales blocks and maps blank."
fi

if ! after 1; then
  harness_fault "$COMP" "the check before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif [ "$SECOND_ON" = "1920" ]; then
  passed "the window on the right screen is told the right screen, and only that"
else
  compositor_verdict "$COMP" \
    "FAIL: the window placed on the right screen is on screens at x '${SECOND_ON:-none}'" \
    "  Expected '1920'. This is the half the all-outputs fallback cannot" \
    "  fake: both windows entered both screens on map, so the right-hand one" \
    "  is only correct here if it was told it left the left-hand screen."
fi

every_check_ran 2
echo "PASS: each window is told the screen it is on and no other"
