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
# The chrome is a client of Domicile too, on a socket of its own, and Domicile
# draws its surface over the apps. Its window is transparent, so an `<app>`
# element is a hole the client shows through — which is how every other Wayland
# compositor does it, and why it costs what one costs.
#
# The Unix socket is still there and still carries the geometry: `place_portal`
# is what this draws with. What it no longer carries is pixels.
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
bun run turbo build:vite --filter @domicile/shell-manganese >/dev/null 2>&1 || {
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

# Which displays Domicile bound: one for the apps, one for the chrome. Which
# socket a client arrives on is how the compositor tells the two apart, so the
# chrome goes on the second and everything the compositor spawns on the first.
DOMICILE_DISPLAY="$(sed -n '/apps connect here/s/.*display="\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"
CHROME_DISPLAY="$(sed -n '/the chrome connects here/s/.*display="\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"
if [ -z "$CHROME_DISPLAY" ]; then
  echo "The compositor did not report a chrome display; cannot put the chrome"
  echo "on it. Its log is above."
  exit 1
fi

# The chrome as our own client. `DOMICILE_COMPOSITED` is what makes its window
# transparent — without it the page paints a desktop over the apps.
WAYLAND_DISPLAY="$CHROME_DISPLAY" \
  DOMICILE_COMPOSITED=1 \
  DOMICILE_CHROME_SOCKET="$CHROME_SOCK" \
  electron --no-sandbox --ozone-platform=wayland "$ROOT/packages/shell-manganese" &
CHROME=$!

echo
echo "If the picture is wrong or nothing responds, the lines to look for above"
echo "are 'the chrome committed a frame' (what the desktop is made of, and"
echo "which way up), 'the chrome has the window's keyboard' (whether input has"
echo "anywhere to go) and 'the window's input reached the compositor'. If none"
echo "of those appear at all, this build predates them — nix caches a branch"
echo "for an hour, so pass --refresh."
echo
echo "Compositor window is up: apps on WAYLAND_DISPLAY=${DOMICILE_DISPLAY:-?},"
echo "the chrome on $CHROME_DISPLAY, both under XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR."
echo "The chrome should be drawn *inside* the compositor's window. Open a"
echo "terminal from it (Alt+Enter) and the terminal should appear inside that"
echo "window too — under the chrome, showing through the <app> element's hole,"
echo "and not on your own desktop. Ctrl-C to stop."
wait "$COMP"
