#!/usr/bin/env bash
# Run a Domicile desktop: the shell, which starts the compositor itself.
#
#   nix develop .#full -c ./scripts/run-native.sh             # manganese
#   nix develop .#full -c ./scripts/run-native.sh simple      # the simple shell
#
# The argument is a shell's directory suffix under `packages/shell-*`, which is
# this repo's naming convention rather than the shell's own name — `packages/`
# is shared with the cargo crates, so the chrome packages carry a prefix.
#
# What this is *not* is a way to start Domicile. There is no such thing: a shell
# is the program a user runs, and the compositor is what it starts underneath
# itself. This builds the two halves out of the checkout and then runs the
# shell's own `bin/` stub — the same one an installed shell puts on `PATH`.
#
# Needs a display — the desktop opens a window on whatever compositor you are
# already running. Domicile draws each client's own buffer through the CSS
# matrix the chrome reported for its `<app>` element, and the chrome's surface
# over the top: no readback, no socket, no IPC, no canvas. Its window is
# transparent, so an `<app>` element is a hole the client shows through.
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
if [ ! -x "$SHELL_DIR/bin/$SHELL_NAME" ]; then
  echo "domicile: no shell '$SHELL_NAME' — packages/shell-$SHELL_NAME has no bin/$SHELL_NAME." >&2
  echo "domicile: available:" >&2
  for candidate in "$ROOT"/packages/shell-*/bin/*; do
    [ -x "$candidate" ] || continue
    echo "  ${candidate##*/}" >&2
  done
  exit 1
fi

if [ -z "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  echo "No display. This one needs a screen — it opens a window."
  echo "For the headless paths see scripts/e2e-*.sh."
  exit 1
fi

# tracing colours its own output; escapes land between a field name and its
# value and make the log harder to read back.
export NO_COLOR=1

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/domicile-rt-native}"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"

# Defaulted on rather than needed everywhere. A store build's sandbox helper is
# not setuid, but Chromium falls back to the namespace sandbox and comes up
# fine wherever unprivileged user namespaces are enabled — which is most hosts.
# What does need this is a host with them disabled, or a container running as
# root, and this script is run in both. The machine's to say rather than the
# shell's, which is why it is an environment variable and why the default is
# overridable: `DOMICILE_ELECTRON_ARGS=` keeps the sandbox on.
DOMICILE_ELECTRON_ARGS="${DOMICILE_ELECTRON_ARGS---no-sandbox}"
export DOMICILE_ELECTRON_ARGS

# Where Electron is, which is a separate question: under a bare `nix develop`
# rather than `.#full` it is in the store and not on `PATH`, and the shell's
# stub is what starts it. Newest by version rather than by store hash; see
# `check.sh`.
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
# that drops most frames and one that keeps up.
cargo build --release -p domicile-compositor || exit 1
# The shell's launcher finds the compositor on `PATH`; out of a checkout there
# is none, so it is named. This is the same variable a packager would use to
# point a shell at a compositor somewhere unusual.
DOMICILE_COMPOSITOR="$ROOT/target/release/domicile-compositor"; export DOMICILE_COMPOSITOR

( cd "$ROOT" && bun install --frozen-lockfile >/dev/null 2>&1 || true )
bun run turbo build:vite --filter "@domicile/shell-$SHELL_NAME" >/dev/null 2>&1 || {
  echo "the shell failed to build"; exit 1;
}

# Whether a window opens is the shell's decision now, out of its own config —
# which this script does not write and must not pretend to know. Saying which
# file was read, and what it said, is the difference between "nothing appeared,
# this is broken" and "nothing appeared, my config says headless".
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/domicile/$SHELL_NAME.json"
echo
echo "Starting $SHELL_NAME. It configures and starts the compositor itself."
if [ -f "$CONFIG" ]; then
  echo "Its config: $CONFIG"
  if grep -q '"present"[[:space:]]*:[[:space:]]*false' "$CONFIG"; then
    echo
    echo "That file says \"present\": false, so this run opens NO window — the"
    echo "chrome draws client frames into a canvas instead. Set it to true (or"
    echo "remove the key) for the windowed desktop this script is written for."
  fi
else
  echo "Its config would be $CONFIG; there is none, so this takes the defaults,"
  echo "which open a window."
fi
echo
echo "The chrome should be drawn *inside* the compositor's window. Open a"
echo "terminal from it (Alt+Enter) and the terminal should appear inside that"
echo "window too — under the chrome, showing through the <app> element's hole,"
echo "and not on your own desktop. Ctrl-C to stop."
echo
echo "If the picture is wrong or nothing responds, the lines to look for are"
echo "'the chrome committed a frame' (what the desktop is made of, and which"
echo "way up), 'the chrome has the window's keyboard' (whether input has"
echo "anywhere to go) and 'the window's input reached the compositor'."
echo
exec env RUST_LOG="${RUST_LOG:-info,domicile_compositor=info}" \
  "$SHELL_DIR/bin/$SHELL_NAME"
