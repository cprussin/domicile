#!/usr/bin/env bash
# Run Domicile: the compositor, in a window, drawing client surfaces itself.
#
#   nix develop .#full -c ./scripts/run-native.sh             # manganese
#   nix develop .#full -c ./scripts/run-native.sh simple      # the simple shell
#
# The argument is a shell's directory suffix under `packages/shell-*`, which is
# this repo's naming convention rather than the shell's own name — `packages/`
# is shared with the cargo crates, so the chrome packages carry a prefix. A
# shell installed anywhere else is pointed at by path; see WORKSPACE.md.
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
# This is the only way to run Domicile. The copy path — pixels read back and
# drawn into a canvas — is still there and is still reached from here: it is
# the fallback for a window the shaders cannot draw, and `disposition` sends
# every `wl_shm` client down it whatever this window is doing. It is a path
# *through* the compositor rather than a way to start one. It had its own
# runner for as long as it was the only thing that worked; a second entry point
# for an internal path is a second thing to keep true, and the one it had went
# wrong in a way this cannot: with no window of its own it could only *ask*
# Electron to size itself to a fixed desktop, and a window manager that refused
# left the desktop in the corner of a larger window. Here the window is the
# compositor's and `adopt_window_scale` makes the desktop follow it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# One argument at most. Silently ignoring the rest would make a typo invisible
# in exactly the case the name check below exists to make loud — and `nix run
# .#native -- simple --foo` is easy to type.
if [ "$#" -gt 1 ]; then
  echo "domicile: expected at most one shell name, got $#: $*" >&2
  exit 1
fi

SHELL_NAME="${1:-manganese}"
SHELL_DIR="$ROOT/packages/shell-$SHELL_NAME"
if [ ! -f "$SHELL_DIR/domicile.shell.json" ]; then
  echo "domicile: no shell '$SHELL_NAME' — packages/shell-$SHELL_NAME is not a chrome package." >&2
  echo "domicile: available:" >&2
  for candidate in "$ROOT"/packages/shell-*/domicile.shell.json; do
    [ -f "$candidate" ] || continue
    candidate="${candidate%/domicile.shell.json}"
    echo "  ${candidate##*/shell-}" >&2
  done
  exit 1
fi

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

# A store build carries no setuid sandbox helper, so Electron refuses to start
# without this — and `.#full` puts one on `PATH`, so being *found* says nothing
# about whether it needs the flag. Unconditional for that reason, and because
# every other script in this repo passes it unconditionally under the same
# shell; this one dropped it for as long as the two were nested, which is a
# shell that exits immediately under a window with no chrome in it.
#
# The machine's to say, not the shell's, which is why it is an environment
# variable rather than anything a manifest can ask for. Overridable, so a real
# system Electron that has its helper can be given `DOMICILE_SHELL_ARGS=`.
DOMICILE_SHELL_ARGS="${DOMICILE_SHELL_ARGS---no-sandbox}"; export DOMICILE_SHELL_ARGS

# Where Electron is, which is a separate question: under a bare `nix develop`
# rather than `.#full` it is in the store and not on `PATH`, and the compositor
# is what starts the shell now, so it is the thing that has to be told. Newest
# by version rather than by store hash; see `check.sh`.
if ! command -v electron >/dev/null 2>&1; then
  ELECTRON_BIN="$(
    ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null |
      sed 's|^.*-electron-\([^/]*\)/bin$|\1\t&|' |
      sort -V | tail -1 | cut -f2
  )"
  if [ -n "$ELECTRON_BIN" ]; then
    DOMICILE_ELECTRON="$ELECTRON_BIN/electron"; export DOMICILE_ELECTRON
  else
    echo "domicile: no electron to run the shell with." >&2
    exit 1
  fi
fi

cd "$ROOT"
# Release, unlike the e2e checks, because this is the interactive run and the
# frame path is where the difference lands. Not only for the copy path, though
# that is where it is worst — `disposition` hands every `wl_shm` client to the
# socket even with a window open, and encoding one 1494x994 frame costs 264ms
# unoptimised against 20ms optimised, which is the gap between a compositor
# that drops most frames and one that keeps up. `weston-flower` and every other
# shm client is that case.
cargo build --release -p domicile-compositor || exit 1
( cd "$ROOT" && bun install --frozen-lockfile >/dev/null 2>&1 || true )
bun run turbo build:vite --filter "@domicile/shell-$SHELL_NAME" >/dev/null 2>&1 || {
  echo "the shell failed to build"; exit 1;
}

# The compositor's own Wayland socket is auto-named; it logs which. It cannot
# have a runtime dir to itself the way a headless run can — presenting means
# being a client of *your* session, so it has to keep your XDG_RUNTIME_DIR to
# find it, and its socket lands in there beside your compositor's.
#
# The log is a file rather than a pipe because `$!` after a pipeline is the PID
# of its *last* command: with `| tee` the liveness check below would be
# watching tee, which outlives a compositor that died on startup.
COMPLOG="$(mktemp)"
# `--shell` is what makes the compositor start the chrome itself: it resolves
# the package, checks the protocol it declares against its own, and puts it on
# the display it made for it. None of that is this script's to arrange any more
# — which is the point, because an installed shell has no script.
# Through `BIN` like every other script here, rather than by literal path. Not
# style: `test-every-launch-names-a-shell.sh` finds launches by that name, so a
# launch spelled any other way is invisible to it — and this is the script a
# person is most likely to edit by hand.
BIN="$ROOT/target/release/domicile-compositor"
RUST_LOG="${RUST_LOG:-info,domicile_compositor=info}" \
  "$BIN" --present --shell "$SHELL_DIR" --chrome-socket "$CHROME_SOCK" \
  >"$COMPLOG" 2>&1 &
COMP=$!
# Its output still reaches the terminal, just by way of the file.
tail -f "$COMPLOG" & TAILER=$!
trap 'kill -9 "$COMP" "$TAILER" 2>/dev/null; rm -f "$COMPLOG"' EXIT
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
# Read only to say so below — the compositor puts the chrome on its own.
DOMICILE_DISPLAY="$(sed -n '/apps connect here/s/.*display="\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"
CHROME_DISPLAY="$(sed -n '/the chrome connects here/s/.*display="\([^"]*\)".*/\1/p' "$COMPLOG" | head -1)"

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
