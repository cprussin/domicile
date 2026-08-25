#!/usr/bin/env bash
# Does the compositor start an *installed* shell, and does that shell connect?
#
#   nix develop .#full -c ./scripts/e2e-shell-launch.sh
#
# The one path nothing else covers. Every other check either drives a headless
# stand-in over the socket, or starts Electron itself and hands it a socket —
# which is what `run-native.sh` used to do and what `e2e-electron.sh` still
# does. Neither exercises the compositor *resolving* a shell and starting it,
# which is the whole subject of `domicile-shell`: its unit tests end at the
# value handed to `Command`, and everything after that is untested by
# construction.
#
# So this installs a shell where an installed shell goes — under an
# `XDG_DATA_HOME` of its own — and names it the way a user's config names one,
# by bare name rather than by path. That covers the search path, the manifest,
# the protocol check, the environment, and the spawn, in the arrangement a user
# actually gets rather than the one a checkout gets.
#
# Headless: the shell's pixels never leave the page here, so this needs Xvfb for
# Electron to have a window at all and no Wayland display of Domicile's.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"
BIN="$ROOT/target/debug/domicile-compositor"

# The smallest shell in the tree, because what is under test is the launching
# rather than the chrome: `simple` has no React tree to mount and no tab rail,
# so a failure here is about the path this script exists to check.
SHELL_NAME="simple"
SHELL_SRC="$ROOT/packages/shell-$SHELL_NAME"

cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

# Electron is not on `PATH` everywhere, and the compositor is what starts the
# shell now — so it is the thing that has to be told, through the same variable
# a packager would use.
if command -v electron >/dev/null 2>&1; then
  DOMICILE_ELECTRON="$(command -v electron)"
else
  ELECTRON_BIN="$(
    ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null |
      sed 's|^.*-electron-\([^/]*\)/bin$|\1\t&|' |
      sort -V | tail -1 | cut -f2
  )"
  [ -n "$ELECTRON_BIN" ] || { echo "SKIP: no electron to run the shell with"; exit 77; }
  DOMICILE_ELECTRON="$ELECTRON_BIN/electron"
fi
export DOMICILE_ELECTRON
# What this machine needs Electron started with. A store build has no setuid
# sandbox helper; a container has no usable /dev/shm and no GPU. All three are
# the machine's business rather than the shell's, which is why they arrive here
# and not in a manifest.
export DOMICILE_SHELL_ARGS="--no-sandbox --disable-gpu --disable-dev-shm-usage"

( cd "$ROOT" && bun run turbo build:vite --filter "@domicile/shell-$SHELL_NAME" ) >/dev/null 2>&1 \
  || { echo "the shell did not build"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-shell-launch"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/domicile-chrome.sock
SOCK="$XDG_RUNTIME_DIR/domicile-chrome.sock"

# A data home of this run's own, so the search path is exercised rather than
# whatever happens to be installed on the machine. The directory is named after
# the shell because a *named* lookup finds it by its directory — which is the
# rule `resolve` enforces and which only an install like this one can check.
DATA_HOME="$(mktemp -d)"
mkdir -p "$DATA_HOME/domicile/shells"
ln -s "$SHELL_SRC" "$DATA_HOME/domicile/shells/$SHELL_NAME"
export XDG_DATA_HOME="$DATA_HOME"
# Emptied rather than left alone: a system-wide shells directory on the machine
# running this would otherwise be on the path behind ours, and a bug that made
# the user's copy invisible would still find one.
export XDG_DATA_DIRS="$DATA_HOME/empty"

LOG="$(mktemp)"
COMP=""
trap 'kill "${COMP:-}" 2>/dev/null; rm -rf "$LOG" "$DATA_HOME"' EXIT

# Electron needs a display even where its pixels do not matter.
ensure_display 1280x800x24 60 || exit 1

# `--shell simple`, by name: the config's own spelling, resolved through
# XDG rather than pointed at a checkout.
# `debug` for the compositor, not `info`: the handshake asserted below reaches
# the log through `chrome -> host`, which is a `debug!`. At `info` this script
# would wait out its deadline against a shell that had connected correctly —
# the same level `e2e-electron.sh` uses, for the same line.
RUST_LOG="info,domicile_compositor=debug" \
  "$BIN" --chrome-socket "$SOCK" --shell "$SHELL_NAME" >"$LOG" 2>&1 &
COMP=$!

# Wait for $2 in $1, or until the compositor is gone, or the deadline.
wait_for() {
  local file="$1" pattern="$2" ticks="${3:-300}"
  for _ in $(seq 1 "$ticks"); do
    grep -q "$pattern" "$file" && return 0
    kill -0 "$COMP" 2>/dev/null || return 1
    sleep 0.2
  done
  return 1
}

echo "== the compositor resolved the installed shell =="
if wait_for "$LOG" 'starting the shell' 150; then
  grep -m1 'starting the shell' "$LOG" | sed 's/^/  /'
  echo "PASS: a shell named with --shell was found on the XDG search path and started"
else
  echo "FAIL: the compositor never started the shell it was asked for."
  echo "  It was installed at $DATA_HOME/domicile/shells/$SHELL_NAME."
  echo "  What the compositor said:"; tail -20 "$LOG" | sed 's/^/    /'
  exit 1
fi

# The assertion that only a real spawn can make: the process started, loaded its
# page, opened the socket the compositor named in its environment, and spoke the
# protocol. Everything up to `Command::spawn` is unit-tested; this is the rest.
echo
echo "== the shell it started connected and handshook =="
if wait_for "$LOG" '"type":"hello"' 300; then
  echo "PASS: the shell handshook over the socket it was told about"
else
  echo "FAIL: the shell was started but never handshook within 60s."
  if ! kill -0 "$COMP" 2>/dev/null; then
    echo "  The compositor exited, so this is about the compositor rather than the shell."
  fi
  echo "  What the compositor said:"; tail -25 "$LOG" | sed 's/^/    /'
  exit 1
fi

# A shell that exits immediately looks identical to one that is running, from
# anywhere except the reaper — which is why the reaper exists, and why this
# looks for what it says. `app.exit` on a failed handshake is the commonest way
# this ends badly, and it happens *after* the line asserted above.
echo
echo "== and it stayed up =="
sleep 2
if grep -q 'the shell exited' "$LOG"; then
  echo "FAIL: the shell exited after connecting."
  grep 'the shell exited' "$LOG" | sed 's/^/    /'
  exit 1
fi
echo "PASS: the shell was still running after its handshake"
