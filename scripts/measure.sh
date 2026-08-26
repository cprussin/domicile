#!/usr/bin/env bash
# Phase 1's measurement: what each path costs, on the same client at the same
# size, with the same keystrokes typed into it.
#
#   nix run 'github:cprussin/domicile#measure'          # 40 keystrokes each
#   nix run 'github:cprussin/domicile#measure' -- 100    # or say how many
#
# Needs a display: half the point is the path that presents to one.
#
# Runs each path in turn — the copy path (pixels read back off the GPU and sent
# to the chrome to be drawn into a canvas) and the native one (the client's
# dmabuf composited directly, with a hole in the page where it goes) — types a
# fixed number of keystrokes into a terminal on each, and prints what the two
# reported.
#
# Release, not debug: on the copy path an unoptimised build spends 264ms a frame
# where release spends 20ms, which is a 4fps ceiling against 50 and would flatter
# the native path enormously.
set -u

export NO_COLOR=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYSTROKES="${1:-40}"

if [ -z "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ] && [ "${DOMICILE_MEASURE_ONLY:-both}" != "copy" ]; then
  echo "No display. The native path presents into a window, so this needs one."
  exit 1
fi

cd "$ROOT"
echo "== building (release) =="
cargo build --release -p domicile-compositor || exit 1
bun install --frozen-lockfile >/dev/null 2>&1 || true
bun run turbo build:vite --filter @domicile/shell-manganese >/dev/null 2>&1 || {
  echo "the shell failed to build"; exit 1;
}
BIN="$ROOT/target/release/domicile-compositor"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/domicile-rt-measure}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"

COMPLOG="$(mktemp)"; CHROMELOG="$(mktemp)"
COPY_COMP="$(mktemp)"; COPY_CHROME="$(mktemp)"
trap 'kill -9 ${COMP:-} ${CHROME:-} ${DRIVER:-} ${APP:-} 2>/dev/null; wait 2>/dev/null;
      rm -f "$COMPLOG" "$CHROMELOG" "$COPY_COMP" "$COPY_CHROME"' EXIT

# One run of one path. $1 names it; $2 is "present" or "copy".
run_path() {
  local name="$1" mode="$2"
  local sock="$XDG_RUNTIME_DIR/measure-$mode.sock"
  rm -f "$sock"
  : >"$COMPLOG"; : >"$CHROMELOG"

  echo
  echo "== $name =="
  if [ "$mode" = "present" ]; then
    RUST_LOG=info "$BIN" --no-shell --present --chrome-socket "$sock" >"$COMPLOG" 2>&1 &
  else
    RUST_LOG=info "$BIN" --no-shell --chrome-socket "$sock" >"$COMPLOG" 2>&1 &
  fi
  COMP=$!
  for _ in $(seq 1 200); do [ -S "$sock" ] && break; sleep 0.05; done
  sleep 1
  if ! kill -0 "$COMP" 2>/dev/null; then
    echo "the compositor exited:"; tail -5 "$COMPLOG"; return 1
  fi

  # The chrome. On the native path it is our own client and its window is
  # transparent; on the copy path it runs in the session it was started from and
  # receives pixels over the socket.
  if [ "$mode" = "present" ]; then
    local chrome_display
    chrome_display="$(sed -n '/the chrome connects here/s/.*display="\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"
    WAYLAND_DISPLAY="$chrome_display" DOMICILE_COMPOSITED=1 \
      DOMICILE_CHROME_SOCKET="$sock" \
      electron --no-sandbox --ozone-platform=wayland "$ROOT/packages/shell-manganese" >"$CHROMELOG" 2>&1 &
  else
    DOMICILE_CHROME_SOCKET="$sock" \
      electron --no-sandbox "$ROOT/packages/shell-manganese" >"$CHROMELOG" 2>&1 &
  fi
  CHROME=$!
  # A run whose chrome never connected measures a compositor with no desktop
  # over the windows, which is not the thing being compared — and it reports as
  # a quietly better number rather than as a failure.
  # Generously: Electron takes seconds to start even on hardware, and longer
  # where it falls back to software rendering. Waiting too briefly here turns a
  # slow start into a failed measurement, which is its own kind of wrong answer.
  local connected=0
  for _ in $(seq 1 600); do
    if grep -q "chrome client connected" "$COMPLOG"; then connected=1; break; fi
    sleep 0.1
  done
  if [ "$connected" = "0" ]; then
    say "the chrome never connected on the $mode run, so there was no desktop"
    say "over the windows. Its numbers would read as better rather than as the"
    say "failure this is. The chrome's last words:"
    tail -5 "$CHROMELOG" | tee -a "$RESULTS"
    return 1
  fi

  # A terminal, and someone to type into it. The driver waits for the window to
  # settle before it starts — see the harness.
  DOMICILE_CHROME_SOCK="$sock" bun "$ROOT/packages/e2e-harness/src/keystroke-driver.ts" \
    "$KEYSTROKES" >/dev/null 2>&1 &
  DRIVER=$!
  local app_display
  app_display="$(sed -n '/apps connect here/s/.*display="\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"
  WAYLAND_DISPLAY="$app_display" kitty >/dev/null 2>&1 &
  APP=$!

  echo "typing $KEYSTROKES keystrokes into a terminal..."
  wait "$DRIVER" 2>/dev/null
  # By pid, never by name. `pkill kitty` killed the terminal this was being run
  # *from*, which is the same terminal the output would have been printed to.
  kill -9 "$APP" 2>/dev/null; wait "$APP" 2>/dev/null
  kill -9 "$CHROME" 2>/dev/null; wait "$CHROME" 2>/dev/null
  kill -9 "$COMP" 2>/dev/null; wait "$COMP" 2>/dev/null
  DRIVER=""; CHROME=""; COMP=""; APP=""
}

# Everything printed also lands in a file. A run takes minutes and ends by
# tearing down what it started; losing the numbers to a closed terminal means
# doing all of it again.
#
# Not under the repo: `nix run` stages the source into the store and runs from
# there, so `$PWD` by this point is a copy that may not be writable and is
# certainly not where anyone would look for it afterwards.
RESULTS="${DOMICILE_RESULTS:-${TMPDIR:-/tmp}/domicile-measurement.txt}"
: >"$RESULTS"
say() { echo "$@" | tee -a "$RESULTS"; }

# `grep … | tail` exits with *tail's* status, which is 0 even when grep matched
# nothing, so the fallback has to be chosen on the text rather than on `||`.
#
# Six rather than three because the chrome's half of this is now placement
# lines, one per interval, and six of them is a wider window to read a trend
# in. Note this widens the compositor's block to six as well — the helper is
# shared — which is deliberate: the two halves are read side by side and want
# to cover the same span.
lines() { grep "$1" "$2" | tail -6; }

report() {
  local composited chrome
  composited="$(lines "frames sent=" "$1")"
  # Every line the chrome prints is prefixed by `main.ts`, so this takes all
  # of them rather than naming one. Selecting on "round trip" dropped the
  # placement line, which is the number this script exists to fetch for the
  # question of whether measuring every window every frame scales.
  chrome="$(lines "^chrome: " "$2")"
  say "-- what the compositor reported"
  say "${composited:-   (nothing — no frames were composited)}"
  say "-- what the chrome reported"
  say "${chrome:-   (nothing — no frames reached it)}"
}

# Which paths to run. Both is the point — one of them alone answers nothing —
# but a machine with no display can still exercise the copy half, which is how
# this script is checked where the native one cannot run.
ONLY="${DOMICILE_MEASURE_ONLY:-both}"

if [ "$ONLY" != "native" ]; then
  run_path "copy path — pixels read back and drawn into a canvas" copy || exit 1
  cp "$COMPLOG" "$COPY_COMP"; cp "$CHROMELOG" "$COPY_CHROME"
  say ""; say "== copy path =="
  report "$COPY_COMP" "$COPY_CHROME"
fi

if [ "$ONLY" != "copy" ]; then
  run_path "native path — the client's own buffer, composited" present || exit 1
  say ""; say "== native path =="
  report "$COMPLOG" "$CHROMELOG"
fi

tee -a "$RESULTS" <<'EOF'

== reading this ==
  response_ms   the client's own think-and-redraw, measured inside the
                compositor on both paths. It is the client's cost, not ours,
                and it is the one number directly comparable between them.
  readback_ms   the GPU copy. The native path does not do it, so a zero here
                is the result rather than a missing measurement.
  composite_ms  the drawing, stopping before the submit. The self-check is that
                `composited x composite_ms` fits inside the reporting interval;
                when it does not, something that waits is being counted as
                something that works. ROADMAP.md's legend has the full reading,
                including what is still in scope and what is unverified.
  submit_ms     the buffer swap, which on a window nested in another compositor
                blocks for a frame callback. Large means nobody is looking at
                the window, not that Domicile is slow. Read it as a caveat on
                `composite_ms` rather than as a cost.
  placements    how many times a window was measured, and what that cost.
  place_ms      Every mounted window is measured on every animation frame so
  place_worst_ms that it follows a CSS transition, and the shell keeps a
  place_total_ms backgrounded window mounted — so this is paid for windows
                nobody is looking at. `place_total_ms` against the interval is
                the fraction of a core it takes. Expected to be similar on both
                paths, being the page's cost rather than the compositor's — so
                a large difference is itself a finding. `place_worst_ms` is
                usually a sample that also *sent* a placement rather than one
                that only measured.
  rt_ms         NOT MEASURED HERE, on either path, and its absence below is a
  ipc_ms        gap rather than a result. Both are timed by the chrome from the
                keystroke *it* sent, and this types over the socket instead —
                which is what makes the two runs comparable, and what puts the
                chrome's own clock out of the loop. What the native run does
                establish is `sent=0`: nothing crosses the socket, so nothing
                crosses the IPC hop those numbers measure.

Parity was never "smaller". It was `readback_ms` and the socket *gone*.
EOF

echo
echo "Also written to $RESULTS"
