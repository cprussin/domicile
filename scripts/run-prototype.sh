#!/usr/bin/env bash
# Launch the Domicile prototype: the headless Wayland compositor + the Electron
# chrome window. Then launch a Wayland app INTO Domicile and watch it appear in the
# chrome.
#
#   nix develop .#full -c ./scripts/run-prototype.sh            # manganese
#   nix develop .#full -c ./scripts/run-prototype.sh simple     # the simple shell
#
# The argument is a shell's directory suffix under `packages/shell-*`, which is
# this repo's naming convention rather than the shell's own name — `packages/`
# is shared with the cargo crates, so the chrome packages carry a prefix. A
# shell installed anywhere else is pointed at by path; see WORKSPACE.md.
#
# In another terminal, put an app on Domicile's display:
#   XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 weston-flower
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# One argument at most. Silently ignoring the rest would make a typo invisible
# in exactly the case the name check below exists to make loud — and `nix run
# .#prototype -- simple --foo` is easy to type.
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

# Domicile's own runtime dir (kept short for Unix-socket limits, and separate from
# your real session so its wayland-1 doesn't clash with your desktop).
DOMICILE_RT="/tmp/domicile-rt"
mkdir -p "$DOMICILE_RT"; chmod 700 "$DOMICILE_RT"
rm -f "$DOMICILE_RT"/wayland-* "$DOMICILE_RT"/domicile-chrome.sock
CHROME_SOCK="$DOMICILE_RT/domicile-chrome.sock"

# Release, unlike the e2e checks: this is the interactive prototype, and the
# frame path is where the difference lands. Encoding one 1494x994 frame costs
# 264ms unoptimised against 20ms optimised — the gap between a compositor that
# drops most frames and one that keeps up.
echo "domicile: building compositor (release)..."
( cd "$ROOT" && cargo build --release -p domicile-compositor ) || { echo "build failed"; exit 1; }

echo "domicile: starting headless Wayland compositor..."
XDG_RUNTIME_DIR="$DOMICILE_RT" "$ROOT/target/release/domicile-compositor" --chrome-socket "$CHROME_SOCK" &
COMP=$!
trap 'kill "$COMP" "$CHROME" 2>/dev/null' EXIT

for _ in $(seq 1 200); do [ -S "$CHROME_SOCK" ] && break; sleep 0.05; done
[ -S "$CHROME_SOCK" ] || { echo "compositor did not come up"; exit 1; }

echo "domicile: building the $SHELL_NAME chrome shell..."
( cd "$ROOT" && bun run turbo build:vite --filter "@domicile/shell-$SHELL_NAME" ) || { echo "shell build failed"; exit 1; }

echo "domicile: starting Electron chrome window..."
# Electron runs in YOUR session (uses your display); it only needs the socket.
DOMICILE_CHROME_SOCKET="$CHROME_SOCK" electron --no-sandbox "$SHELL_DIR" &
CHROME=$!

cat <<EOF

  Domicile is running.
    - The Electron window IS the chrome (a web page).
    - Domicile's Wayland display is 'wayland-1' under XDG_RUNTIME_DIR=$DOMICILE_RT

  Put an app onto Domicile (in another terminal, inside 'nix develop .#full'):

    XDG_RUNTIME_DIR=$DOMICILE_RT WAYLAND_DISPLAY=wayland-1 weston-flower

  A styled <app> portal should appear in the chrome window. Close the window
  (or Ctrl-C here) to stop.

EOF

wait "$CHROME" 2>/dev/null
