#!/usr/bin/env bash
# Run the compositor with a window, drawing client surfaces itself.
#
#   nix develop .#full -c ./scripts/run-native.sh
#
# Needs a display — it opens a window on whatever compositor you are already
# running. What appears in that window is Domicile compositing a Wayland
# client's own buffer through the transform the chrome laid out for it: no
# readback, no socket, no IPC, no canvas.
#
# The chrome still runs as it does today, over the Unix socket, because it is
# what decides where windows go — `place_portal` is the geometry this draws
# with. It is not composited into the window yet, so what you should see is a
# terminal on a black background at the position and size the chrome's `<app>`
# element has, and *not* see is any of the chrome's own furniture.
#
# The comparison this exists for: `scripts/run-prototype.sh` is the same thing
# on the copy path. Its `frames` line reports readback_ms and the chrome's
# reports ipc_ms; both should be absent here, because neither step happens.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  echo "No display. This one needs a screen — it opens a window."
  echo "For the headless paths see scripts/e2e-*.sh."
  exit 1
fi

# tracing colours its own output, and the display name is read back out of it
# below; escapes would land between the field name and its value.
export NO_COLOR=1

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/domicile-rt-native}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
CHROME_SOCK="$XDG_RUNTIME_DIR/domicile-native.sock"
rm -f "$CHROME_SOCK"

cd "$ROOT"
cargo build -p domicile-compositor || exit 1
( cd "$ROOT" && bun install --frozen-lockfile >/dev/null 2>&1 || true )
bun run turbo build:vite --filter @domicile/shell >/dev/null 2>&1 || {
  echo "the shell failed to build"; exit 1;
}

# The compositor's own Wayland socket is auto-named; it logs which. Unlike the
# headless prototype it cannot have a runtime dir to itself — presenting means
# being a client of *your* session, so it has to keep your XDG_RUNTIME_DIR to
# find it, and its socket lands in there beside your compositor's.
#
# The log is a file rather than a pipe because `$!` after a pipeline is the PID
# of its *last* command: with `| tee` the liveness check below would be
# watching tee, which outlives a compositor that died on startup.
COMPLOG="$(mktemp)"
RUST_LOG="${RUST_LOG:-info,domicile_compositor=info}" \
  ./target/debug/domicile-compositor --present --chrome-socket "$CHROME_SOCK" \
  >"$COMPLOG" 2>&1 &
COMP=$!
# Its output still reaches the terminal, just by way of the file.
tail -f "$COMPLOG" & TAILER=$!
trap 'kill -9 "$COMP" "$TAILER" ${CHROME:-} 2>/dev/null; rm -f "$COMPLOG"' EXIT
for _ in $(seq 1 200); do [ -S "$CHROME_SOCK" ] && break; sleep 0.05; done

# A compositor that died leaves its socket behind for a moment, so waiting for
# the socket is not the same as it being up. Say what happened rather than
# printing instructions for a window that was never opened.
sleep 0.5
if ! kill -0 "$COMP" 2>/dev/null; then
  echo
  echo "The compositor exited instead of opening a window; its error is above."
  if grep -q "NoWaylandLib" "$COMPLOG"; then
    echo "  winit could not dlopen the Wayland client library. It is dlopened"
    echo "  rather than linked, so it must be on LD_LIBRARY_PATH and not merely"
    echo "  in the shell — the same trap libEGL has. The .#full shell puts it"
    echo "  there; a shell that does not is the likely cause."
  elif grep -q "NoCompositor" "$COMPLOG"; then
    echo "  winit found the library but no compositor at \$WAYLAND_DISPLAY."
    echo "  This one nests inside your session, so it needs a real one running."
  fi
  exit 1
fi

# The chrome, still over the socket: it is the source of the geometry, not yet
# something the window draws.
DOMICILE_CHROME_SOCKET="$CHROME_SOCK" electron --no-sandbox "$ROOT/apps/shell" &
CHROME=$!

# Which display Domicile bound. A terminal opened from the chrome is spawned by
# the compositor onto *this* one; seeing it appear on your own desktop instead
# means the child got your session's display rather than Domicile's.
DOMICILE_DISPLAY="$(sed -n 's/.*socket_name="\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"

echo
echo "Compositor window is up on WAYLAND_DISPLAY=${DOMICILE_DISPLAY:-?} under"
echo "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR. Open a terminal from the chrome"
echo "(Alt+Enter) and it should appear *in the compositor's window*, not on"
echo "your own desktop and not in the chrome's canvas. Ctrl-C to stop."
wait "$COMP"
