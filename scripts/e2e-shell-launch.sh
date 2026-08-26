#!/usr/bin/env bash
# Does running the *shell* bring up a whole desktop?
#
#   nix develop .#full -c ./scripts/e2e-shell-launch.sh
#
# The one path nothing else covers, and the arrangement a user actually gets: a
# shell is the program on `PATH`, and the compositor is what it starts
# underneath itself. Every other check here drives a headless stand-in over the
# chrome socket, or starts Electron itself and hands it a socket — neither
# exercises the launcher, whose whole job is to start a compositor, learn what
# it bound, and start the chrome inside it.
#
# So this runs `bin/simple` the way a user would, with a config file of the
# shell's own, and asserts the two halves found each other.
#
# Headless: the shell's pixels never leave the page here, so this needs Xvfb for
# Electron to have a window at all and no Wayland display of Domicile's.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"

# The smallest shell in the tree, because what is under test is the launching
# rather than the chrome: `simple` has no React tree to mount and no tab rail,
# so a failure here is about the path this script exists to check.
SHELL_NAME="simple"
SHELL_SRC="$ROOT/packages/shell-$SHELL_NAME"
BIN="$ROOT/target/debug/domicile-compositor"

cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
# Where the shell's launcher looks for a compositor. On a machine with Domicile
# installed this is on `PATH`; here it is the build under test.
export DOMICILE_COMPOSITOR="$BIN"

# Electron is not on `PATH` everywhere, and the shell's stub is what starts it.
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
# What this machine needs Electron started with, and all three are the
# machine's business rather than the shell's — which is why they arrive here
# and not in anything a shell declares.
#
# `--no-sandbox` because the places this is driven from cannot give Chromium a
# usable namespace sandbox: this repo's dev container runs as root, which
# Electron refuses outright, and a CI runner image may restrict unprivileged
# user namespaces. Not because it is a store build — that helper is indeed not
# setuid, but Chromium falls back to the namespace sandbox and a store-built
# shell comes up sandboxed as an ordinary user on an ordinary host. The other
# two are a container with no usable /dev/shm and no GPU.
export DOMICILE_ELECTRON_ARGS="--no-sandbox --disable-gpu --disable-dev-shm-usage"

( cd "$ROOT" && bun run turbo build:vite --filter "@domicile/shell-$SHELL_NAME" ) >/dev/null 2>&1 \
  || { echo "the shell did not build"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-shell-launch"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -rf "${XDG_RUNTIME_DIR:?}"/domicile-*

# The shell's own config file, in the shell's own schema, where the shell looks
# for it. Nothing here writes anything of Domicile's: that is the point — the
# compositor's configuration is generated from this by the shell.
CONFIG_HOME="$(mktemp -d)"
mkdir -p "$CONFIG_HOME/domicile"
cat >"$CONFIG_HOME/domicile/$SHELL_NAME.json" <<'JSON'
{
  "present": false,
  "desktop": {
    "displays": [{ "name": "only", "size": [1280, 800] }]
  }
}
JSON
export XDG_CONFIG_HOME="$CONFIG_HOME"

LOG="$(mktemp)"
SHELL_PID=""
trap 'kill "${SHELL_PID:-}" 2>/dev/null; rm -rf "$LOG" "$CONFIG_HOME"' EXIT

# Electron needs a display even where its pixels do not matter.
ensure_display 1280x800x24 60 || exit 1

# `debug` for the compositor, not `info`: the handshake asserted below reaches
# the log through `chrome -> host`, which is a `debug!`. At `info` this script
# would wait out its deadline against a shell that had connected correctly —
# the same level `e2e-electron.sh` uses, for the same line.
#
# Through the shell's stub, which is the whole subject: it is what a user runs.
RUST_LOG="info,domicile_compositor=debug" \
  "$SHELL_SRC/bin/$SHELL_NAME" >"$LOG" 2>&1 &
SHELL_PID=$!

# Wait for $2 in $1, or until the shell is gone, or the deadline.
wait_for() {
  local file="$1" pattern="$2" ticks="${3:-300}"
  for _ in $(seq 1 "$ticks"); do
    grep -q "$pattern" "$file" && return 0
    kill -0 "$SHELL_PID" 2>/dev/null || return 1
    sleep 0.2
  done
  return 1
}

echo "== the shell started a compositor =="
if wait_for "$LOG" 'the chrome connects here' 150; then
  grep -m1 'the chrome connects here' "$LOG" | sed 's/^/  /'
  echo "PASS: running the shell brought a compositor up"
else
  echo "FAIL: no compositor came up when the shell was run."
  echo "  What it said:"; tail -25 "$LOG" | sed 's/^/    /'
  exit 1
fi

# The assertion only a real launch can make: the compositor came up, the
# launcher read what it published, started Electron pointed at the socket named
# in it, and the page spoke the protocol. Everything up to `spawn` is
# unit-tested; this is the rest.
echo
echo "== and the chrome it started connected and handshook =="
if wait_for "$LOG" '"type":"hello"' 300; then
  echo "PASS: the chrome handshook over the socket the launcher gave it"
else
  echo "FAIL: the chrome never handshook within 60s."
  if ! kill -0 "$SHELL_PID" 2>/dev/null; then
    echo "  The shell exited, so this is about the launcher rather than the page."
  fi
  echo "  What it said:"; tail -25 "$LOG" | sed 's/^/    /'
  exit 1
fi

# A desktop that exits immediately looks identical to one that is running, from
# anywhere except its parent — which is what the launcher is, and why it reports
# the exit rather than leaving a compositor behind.
echo
echo "== and it stayed up =="
sleep 2
if ! kill -0 "$SHELL_PID" 2>/dev/null; then
  echo "FAIL: the shell exited after connecting."
  tail -15 "$LOG" | sed 's/^/    /'
  exit 1
fi
echo "PASS: the desktop was still running after its handshake"

# And the half none of the above proves: that the *shell's* config is what the
# compositor ran on. Nothing in a healthy run says so out loud — the desktop is
# described over the socket rather than logged — so this asks the compositor to
# refuse. Two displays sharing a name is a mistake no schema can catch on one
# display at a time: each is a perfectly good display, and only the layout they
# make together is impossible. So it passes the shell's own reader and is
# rejected by the compositor, in a message naming the name this file chose —
# which can only exist if a value written here reached the compositor.
# Stopped the way a session manager stops one, and bounded: a launcher that
# regressed to unkillable would otherwise hang this script rather than fail it,
# which on CI reads as a stuck job rather than a broken shell.
kill "$SHELL_PID" 2>/dev/null
STOPPED=1
for _ in $(seq 1 100); do
  kill -0 "$SHELL_PID" 2>/dev/null || { STOPPED=0; break; }
  sleep 0.1
done
wait "$SHELL_PID" 2>/dev/null
SHELL_PID=""

echo
echo "== and it took the whole desktop with it =="
if [ "$STOPPED" != "0" ]; then
  echo "FAIL: the shell did not stop within 10s of a TERM."
  echo "  A launcher that installs signal handlers and forwards nothing is"
  echo "  immune to the stop it was handed; see forward-stops.ts."
  exit 1
fi
# The one thing only this check can see, and the class of bug this launcher has
# produced more than once: a compositor left running, or a run directory left
# behind with a live socket in it. Both are invisible to every other check here
# — nothing else starts the real launcher — and both look exactly like success
# from anywhere but the filesystem and the process table.
LEFTOVER="$(ls -d "$XDG_RUNTIME_DIR"/domicile-* 2>/dev/null || true)"
if [ -n "$LEFTOVER" ]; then
  echo "FAIL: the shell left its run directory behind:"
  echo "$LEFTOVER" | sed 's/^/    /'
  ls -la $LEFTOVER 2>/dev/null | sed 's/^/    /'
  exit 1
fi
# Matched on *this run's* runtime directory rather than on the binary: every
# compositor in the tree is the same path, so a leftover from another script in
# the same `check.sh` would otherwise be reported as this shell's orphan. The
# launcher puts its run directory under here and names it on the command line,
# so this matches that compositor and no other.
if pgrep -f "$XDG_RUNTIME_DIR/domicile-" >/dev/null 2>&1; then
  echo "FAIL: a compositor outlived the shell that started it:"
  pgrep -af "$XDG_RUNTIME_DIR/domicile-" | sed 's/^/    /'
  pkill -f "$XDG_RUNTIME_DIR/domicile-" 2>/dev/null
  exit 1
fi
echo "PASS: no compositor and no run directory outlived the shell"

echo
echo "== and the compositor runs on the shell's own config =="
cat >"$CONFIG_HOME/domicile/$SHELL_NAME.json" <<'JSON'
{
  "present": false,
  "desktop": {
    "displays": [
      { "name": "twice-over", "size": [1280, 800] },
      { "name": "twice-over", "position": [1280, 0], "size": [1280, 800] }
    ]
  }
}
JSON
REFUSED="$(mktemp)"
if timeout 60 "$SHELL_SRC/bin/$SHELL_NAME" >"$REFUSED" 2>&1; then
  echo "FAIL: the shell started on a desktop the compositor should have refused."
  tail -15 "$REFUSED" | sed 's/^/    /'
  rm -f "$REFUSED"
  exit 1
fi
if grep -q 'both named twice-over' "$REFUSED"; then
  grep -m1 'both named twice-over' "$REFUSED" | sed 's/^/  /'
  echo "PASS: a display written in the shell's file was refused by the compositor"
  rm -f "$REFUSED"
else
  echo "FAIL: the shell stopped, but not with the compositor's complaint about"
  echo "  the displays this run put in its config — so what reached the"
  echo "  compositor is not what the shell was configured with."
  tail -20 "$REFUSED" | sed 's/^/    /'
  rm -f "$REFUSED"
  exit 1
fi
