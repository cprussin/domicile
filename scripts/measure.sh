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

if [ -z "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  echo "No display. The native path presents into a window, so this needs one."
  exit 1
fi

cd "$ROOT"
echo "== building (release) =="
cargo build --release -p domicile-compositor || exit 1
bun install --frozen-lockfile >/dev/null 2>&1 || true
bun run turbo build:vite --filter @domicile/shell >/dev/null 2>&1 || {
  echo "the shell failed to build"; exit 1;
}
BIN="$ROOT/target/release/domicile-compositor"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/domicile-rt-measure}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"

COMPLOG="$(mktemp)"; CHROMELOG="$(mktemp)"
COPY_COMP="$(mktemp)"; COPY_CHROME="$(mktemp)"
trap 'kill -9 ${COMP:-} ${CHROME:-} ${DRIVER:-} 2>/dev/null; wait 2>/dev/null;
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
    RUST_LOG=info "$BIN" --present --chrome-socket "$sock" >"$COMPLOG" 2>&1 &
  else
    RUST_LOG=info "$BIN" --chrome-socket "$sock" >"$COMPLOG" 2>&1 &
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
      electron --no-sandbox --ozone-platform=wayland "$ROOT/apps/shell" >"$CHROMELOG" 2>&1 &
  else
    DOMICILE_CHROME_SOCKET="$sock" \
      electron --no-sandbox "$ROOT/apps/shell" >"$CHROMELOG" 2>&1 &
  fi
  CHROME=$!
  sleep 3

  # A terminal, and someone to type into it. The driver waits for the window to
  # settle before it starts — see the harness.
  DOMICILE_CHROME_SOCK="$sock" bun "$ROOT/packages/e2e-harness/src/keystroke-driver.ts" \
    "$KEYSTROKES" >/dev/null 2>&1 &
  DRIVER=$!
  local app_display
  app_display="$(sed -n '/apps connect here/s/.*display="\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"
  WAYLAND_DISPLAY="$app_display" kitty >/dev/null 2>&1 &

  echo "typing $KEYSTROKES keystrokes into a terminal..."
  wait "$DRIVER" 2>/dev/null
  kill -9 "$CHROME" 2>/dev/null; wait "$CHROME" 2>/dev/null
  kill -9 "$COMP" 2>/dev/null; wait "$COMP" 2>/dev/null
  pkill -9 -f "apps/shell" 2>/dev/null
  pkill -9 kitty 2>/dev/null
  DRIVER=""; CHROME=""; COMP=""
}

report() {
  echo "-- what the compositor reported"
  grep "frames sent=" "$1" | tail -3 || echo "   (nothing — no frames were composited)"
  echo "-- what the chrome reported"
  grep "round trip" "$2" | tail -3 || echo "   (nothing)"
}

run_path "copy path — pixels read back and drawn into a canvas" copy || exit 1
cp "$COMPLOG" "$COPY_COMP"; cp "$CHROMELOG" "$COPY_CHROME"
report "$COPY_COMP" "$COPY_CHROME"

run_path "native path — the client's own buffer, composited" present || exit 1
report "$COMPLOG" "$CHROMELOG"

cat <<'EOF'

== reading this ==
  response_ms   the client's own think-and-redraw, measured inside the
                compositor on both paths. It is the client's cost, not ours,
                and it is the one number directly comparable between them.
  readback_ms   the GPU copy. The native path does not do it, so a zero here
                is the result rather than a missing measurement.
  rt_ms         key to pixels on screen, measured by the chrome — which is in
                the frame path only on the copy path. Its absence on the native
                run is the same result said the other way.
  ipc_ms        the chrome's main-to-renderer hop, where a frame's megabytes
                are structured-cloned. Unfixable in Electron; gone natively
                because no frame crosses it.

Parity was never "smaller". It was `readback_ms` and `ipc_ms` *gone*.
EOF
