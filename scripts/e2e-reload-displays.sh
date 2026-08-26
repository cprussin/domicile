#!/usr/bin/env bash
# Does editing the display list reach a chrome that is already connected?
#
#   nix develop .#full -c ./scripts/e2e-reload-displays.sh
#
# The desktop used to be whatever the config said at startup and nothing after
# it: one `Config::load`, one set of `wl_output` globals, fixed for the run.
# Plugging a monitor in meant restarting the compositor, which on a desktop
# means every window.
#
# Each half is unit-tested — `Screens::rearranged_into` decides which outputs
# survive a new list, `ConfigStore` keeps a half-written save from taking the
# live config down — and neither proves that a file changing on disk reaches a
# page that is already laid out against the old desktop.
#
# Needs a client but no display: two descriptions over the chrome socket, and a
# real window open across the reload to prove the new output reached it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

# The client whose `wl_surface.enter` check 3 reads. Skipped rather than failed
# when it is absent: a check that cannot run must say so — see check.sh — and
# without this the missing binary reaches check 3 as a client that never bound
# an output, which is a harness fault reported as a client-visible one.
command -v weston-terminal >/dev/null 2>&1 || {
  echo "SKIP: no weston-terminal, which is the window this opens across the reload."
  exit 77
}
# The other dependency, and it needs its own: without bun the probe writes
# nothing, the handshake guard below fires `harness_fault`, and the run exits
# 99 — which `check.sh` counts as a failure and prints as this script's own
# machinery having broken. Which it has not; it was never installed.
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: no bun, which runs the probe that reads the descriptions."
  exit 77
}

export XDG_RUNTIME_DIR="/tmp/domicile-rt-reload"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
export SOCK="$XDG_RUNTIME_DIR/c.sock"
OUT="$(mktemp)"; CLIENT="$(mktemp)"
# In the runtime directory rather than `mktemp`'s: `domicile_config::watch`
# watches the file's *parent*, because editors save by atomic rename and a
# direct file watch misses it. Left in /tmp that would be every process on the
# machine writing a temp file, and this run would reload on all of them.
CONF="$XDG_RUNTIME_DIR/domicile.json"
COMP=""; PROBE=""; APP=""

left() {
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
      }
    ]
  }
}
JSON
}

# The second display is written beside the first at twice the density, so what
# has to survive the reload is more than a name: the position is where a
# `<Screen>` goes on the page and the scale is what clients on it draw at.
both() {
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
}

left
"$BIN" --session "$SOCK.session" --config "$CONF" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
# `wait` after the kill so bash reaps the jobs quietly; without it it reports
# "Killed" on stderr at exit, which reads like a failure in a passing run.
cleanup() { kill -9 "$COMP" "$PROBE" "$APP" 2>/dev/null; wait 2>/dev/null; rm -f "$OUT" "$CLIENT" "$CONF"; }
trap cleanup EXIT
for _ in $(seq 1 200); do
  [ -S "$SOCK" ] && break
  sleep 0.05
done

# Wide enough to outlive every wait below it, which run in sequence: 5s for the
# handshake, 5s for the client's first enter, 10s for the reloaded description
# and 5s for the client to be told about it. 25s of polling, so 40s here and
# `timeout 40` on the client — a budget that is shorter than the sum is a run
# that can spend its tail reading a file whose writer is already dead, and
# report that as a compositor that never spoke.
DOMICILE_CHROME_LISTEN_MS=40000 DOMICILE_CHROME_SOCK="$SOCK" \
  bun "$ROOT/packages/e2e-harness/src/reload-displays-probe.ts" >"$OUT" 2>&1 &
PROBE=$!

ONE="left@0,0+1920x1080@1"
TWO="left@0,0+1920x1080@1 right@1920,0+2560x1440@2"

# The desktop it started on, before anything is rewritten. Waited for rather
# than slept past: the assertion below reads this line, and a rewrite that
# landed before the probe had handshaken would be a reload nothing was
# listening for — which fails as a compositor that never re-advertised.
for _ in $(seq 1 100); do grep -q "^displays: " "$OUT" && break; sleep 0.05; done
if ! grep -q "^displays: " "$OUT"; then
  harness_fault "$COMP" "the probe could be told the desktop it started on" \
    "ERROR: the probe was never told any desktop, so nothing below it was" \
    "  tested; its output was:" \
    "$(cat "$OUT")"
fi

# The first description. Its bail is the guard above rather than an arm of the
# `if` below, because it is a different question — "was anything described at
# all" against "was it the right thing" — and the guard exits, so nothing falls
# past it into the verdict. Checks 2 and 3 do have their bail as a first arm,
# where the premise being checked is one of the same decision's outcomes.
STARTED="$(sed -n '1s/^displays: //p' "$OUT")"
if [ "$STARTED" = "$ONE" ]; then
  passed "the chrome was told the one display the config started with"
else
  compositor_verdict "$COMP" \
    "FAIL: the chrome started on '$STARTED'" \
    "  Expected '$ONE'. Nothing has been reloaded yet, so this is the" \
    "  startup path rather than the one this script is about."
fi

# A real client, mapped against the one-display desktop and still running when
# the second appears. This is what the reload is *for*: a window open across it
# has to be told about the display that arrived, and a toolkit that scales its
# content reads `wl_surface.enter` to decide what density to draw at. Started
# before the edit so it is a window the reload finds, not one that mapped onto
# the finished desktop and would have entered both anyway.
NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 40 weston-terminal >"$CLIENT" 2>&1 &
APP=$!
for _ in $(seq 1 50); do
  grep -qE "wl_surface[#@][0-9]+\.enter\(" "$CLIENT" && break
  sleep 0.1
done

# The edit. A whole file rather than an append, because that is what an editor
# does and what the watcher is written for.
both

# The second description, which is the assertion. Bounded, so a compositor that
# never notices the edit fails here rather than hanging.
for _ in $(seq 1 200); do [ "$(grep -c "^displays: " "$OUT")" -ge 2 ] && break; sleep 0.05; done

echo "== what the chrome was told, in order =="
cat "$OUT"

if ! after 1; then
  harness_fault "$COMP" "the first description could be checked" \
    "ERROR: the desktop this reload starts from was never established."
elif [ "$(grep -c "^displays: " "$OUT")" -lt 2 ]; then
  compositor_verdict "$COMP" \
    "FAIL: the chrome was never told about the reloaded desktop." \
    "  The config now names two displays and the page connected to it is" \
    "  still laying out against one. A display list fixed at startup is the" \
    "  gap this closes: plugging a monitor in should not mean restarting" \
    "  every window on the desktop."
else
  RELOADED="$(sed -n '2s/^displays: //p' "$OUT")"
  if [ "$RELOADED" = "$TWO" ]; then
    passed "the added display reached a chrome that was already connected"
  else
    compositor_verdict "$COMP" \
      "FAIL: after the reload the chrome was told '$RELOADED'" \
      "  Expected '$TWO'. The reload was noticed, so this is what the new" \
      "  desktop was described as rather than whether it was described." \
      "  Position and scale ride with the name: a <Screen> uses all three."
  fi
fi

# And the window that was already open when the display appeared.
#
# Distinct outputs rather than two events: entering the same one twice is not
# two screens, and counting alone cannot tell them apart. This window has no
# portal — no chrome ever placed it — so it belongs on every display, which is
# what `Screens::entered_by` falls back to and what makes two the answer here.
for _ in $(seq 1 50); do
  [ "$(grep -oE "wl_surface[#@][0-9]+\.enter\(wl_output[#@][0-9]+\)" "$CLIENT" \
    | sed 's/.*(//' | sort -u | wc -l)" -ge 2 ] && break
  sleep 0.1
done

echo
echo "== the outputs the client's own surface entered =="
grep -oE "wl_surface[#@][0-9]+\.enter\([^)]*\)" "$CLIENT" | head
ENTERED="$(grep -oE "wl_surface[#@][0-9]+\.enter\(wl_output[#@][0-9]+\)" "$CLIENT" \
  | sed 's/.*(//' | sort -u | wc -l)"

if ! after 2; then
  harness_fault "$COMP" "the checks before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif ! grep -qE "wl_registry[#@][0-9]+\.global\([0-9]+, \"wl_output\"" "$CLIENT"; then
  harness_fault "$COMP" "the client could bind an output" \
    "ERROR: the client never saw a wl_output global; its log begins:" \
    "$(head -5 "$CLIENT")"
elif [ "$ENTERED" -ge 2 ]; then
  passed "the window open across the reload was told about the new display"
else
  compositor_verdict "$COMP" \
    "FAIL: the window entered $ENTERED of 2 outputs after the reload" \
    "  It was open before the display appeared, so nothing else will tell" \
    "  it: a toolkit picks its density from wl_surface.enter, and a window" \
    "  that never entered the new screen draws for the old one on it."
fi

every_check_ran 3
