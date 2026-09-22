#!/usr/bin/env bash
# A desktop that is up is told to serve another shell, and does.
#
#   ./scripts/test-a-running-desktop-takes-a-new-shell.sh
#
# The unit tests own both halves of this on their own: `tests/cli.rs` what the
# verb takes, `tests/command.rs` the line the engine is sent, and
# `tests/command_socket.rs` what comes back. This owns the join, which is the
# half they cannot reach — that the supervisor puts a command socket on the
# engine's command line, that a `domicile load-shell` typed in another terminal
# reaches the supervisor over DOMICILE_SOCK and is routed on to that socket,
# and that an engine's refusal comes back out of the terminal the command was
# typed in rather than into a log nobody is reading.
#
# THE ENGINE HERE IS TWENTY LINES OF PYTHON, and it is the fake that makes this
# testable at all: the real one is a Chromium that takes four hours to build
# and a display to run. What it stands in for is exactly the socket —
# `components/domicile/browser/command_protocol.cc` is the engine's own half
# and has unit tests of its own in that tree.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${CARGO_TARGET_DIR:-$ROOT/target}"

command -v cargo >/dev/null 2>&1 || { echo "SKIP: no cargo"; exit 77; }
command -v python3 >/dev/null 2>&1 || {
  echo "SKIP: no python3, which is what binds the engine's command socket here"
  exit 77
}

echo "== building domicile =="
( cd "$ROOT" && cargo build -q -p domicile-launch --bin domicile ) || {
  echo "FAIL: domicile would not build"; exit 1; }
DOMICILE="$TARGET/debug/domicile"
[ -x "$DOMICILE" ] || { echo "FAIL: no binary at $DOMICILE"; exit 1; }

WORK="$(mktemp -d)"
DESKTOP=""
cleanup() {
  [ -n "$DESKTOP" ] && { kill "$DESKTOP" 2>/dev/null; wait "$DESKTOP" 2>/dev/null; }
  pkill -f "$WORK/engine/chrome" 2>/dev/null
  pkill -f "$WORK/domicile-compositor" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# Two shells: the one the desktop starts on and the one it is told to take.
# Neither is loaded by anything — the engine here serves no pages — but they
# are the files that have to be on disk for a path to resolve to one.
mkdir -p "$WORK/first" "$WORK/second"
: >"$WORK/first/shell.js"
: >"$WORK/second/shell.js"

# What the engine answers next. Written by the test, read per connection, so
# one desktop covers a command that was carried out and one that was refused.
echo loaded >"$WORK/answer"

# The engine: creates the broker socket, binds the command socket it was given,
# and answers one line per connection — which is the engine's own rule, not
# this fake's convenience.
mkdir -p "$WORK/engine"
cat >"$WORK/engine/chrome" <<ENGINE
#!/usr/bin/env python3
import json, os, socket, sys

broker = command = None
for arg in sys.argv[1:]:
    if arg.startswith("--domicile-broker-socket="):
        broker = arg.split("=", 1)[1]
    elif arg.startswith("--domicile-command-socket="):
        command = arg.split("=", 1)[1]

# What the supervisor put on the command line, for the test to read back.
with open("$WORK/engine-argv", "w") as saying:
    saying.write("\n".join(sys.argv[1:]))

if command is None:
    # An engine with no command socket has nothing to serve here, and a
    # desktop that came up anyway would let every assertion below pass for
    # the wrong reason.
    sys.exit("no --domicile-command-socket")

listening = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
listening.bind(command)
listening.listen(4)
# After the bind, so the supervisor's wait for the broker is also a wait for
# a command socket that is ready to be dialed.
open(broker, "w").close()

while True:
    connection, _ = listening.accept()
    line = b""
    while not line.endswith(b"\n"):
        got = connection.recv(4096)
        if not got:
            break
        line += got
    with open("$WORK/engine-heard", "a") as heard:
        heard.write(line.decode())
    answer = open("$WORK/answer").read().strip()
    reply = ({"type": "loaded"} if answer == "loaded"
             else {"type": "refused", "why": answer})
    connection.sendall((json.dumps(reply) + "\n").encode())
    connection.close()
ENGINE
chmod +x "$WORK/engine/chrome"

cat >"$WORK/domicile-compositor" <<'COMPOSITOR'
#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in --session) session="$2"; shift ;; esac
  shift
done
: >"$session"
exec sleep 60
COMPOSITOR
chmod +x "$WORK/domicile-compositor"

mkdir -p "$WORK/runtime"
LOG="$WORK/desktop.log"
env OZONE=headless \
    XDG_RUNTIME_DIR="$WORK/runtime" \
    DOMICILE_ENGINE="$WORK/engine" \
    DOMICILE_COMPOSITOR="$WORK/domicile-compositor" \
    "$DOMICILE" "$WORK/first/shell.js" >"$LOG" 2>&1 &
DESKTOP=$!

WAITED=0
while ! grep -q "domicile is up" "$LOG" 2>/dev/null; do
  if [ "$WAITED" -ge 100 ]; then
    echo "FAIL: the desktop never came up, so nothing below would mean"
    echo "      anything. What it said:"
    sed 's/^/    /' "$LOG"
    exit 1
  fi
  sleep 0.1
  WAITED=$((WAITED + 1))
done
SOCK="$(sed -n 's/^DOMICILE_SOCK=//p' "$LOG")"

FAILED=0

# Put one command to the desktop, the way a terminal started inside it would.
ask_desktop() {
  env DOMICILE_SOCK="$SOCK" "$DOMICILE" "$@" 2>&1
}

echo "== the engine was started with a command socket of this run's own =="
GIVEN="$(sed -n 's/^--domicile-command-socket=//p' "$WORK/engine-argv")"
case "$GIVEN" in
  "$WORK/runtime/domicile-"*/command.sock)
    echo "PASS: $GIVEN" ;;
  *)
    echo "FAIL: the engine was given '$GIVEN', and this run's own directory is"
    echo "      $WORK/runtime/domicile-<pid>"
    FAILED=1 ;;
esac

echo "== load-shell reaches the engine as the line the protocol says it is =="
SAID="$(ask_desktop load-shell "$WORK/second/shell.js")"
HEARD="$(tail -n 1 "$WORK/engine-heard" 2>/dev/null)"
WANT="{\"type\":\"load_shell\",\"version\":1,\"root\":\"$WORK/second\",\"module\":\"shell.js\"}"
if [ "$HEARD" = "$WANT" ]; then
  echo "PASS: $HEARD"
else
  echo "FAIL: the engine heard '$HEARD'"
  echo "      and the protocol says  $WANT"
  FAILED=1
fi

echo "== and the terminal is told which shell the desktop is on now =="
if [ "$SAID" = "$WORK/second/shell.js" ]; then
  echo "PASS: $SAID"
else
  echo "FAIL: load-shell said '$SAID', and it loaded $WORK/second/shell.js"
  FAILED=1
fi

echo "== which-shell answers with the shell that was loaded, not the one it started on =="
# The supervisor holds which shell is served and a load changes it. Answering
# with the module this run began on would be a desktop describing one that is
# no longer there.
NOW="$(ask_desktop which-shell)"
if [ "$NOW" = "$WORK/second/shell.js" ]; then
  echo "PASS: $NOW"
else
  echo "FAIL: which-shell said '$NOW', and the desktop is serving"
  echo "      $WORK/second/shell.js"
  FAILED=1
fi

echo "== an engine that refuses is quoted to whoever typed the command =="
echo "this engine has no shell window to load a shell into" >"$WORK/answer"
REFUSED="$WORK/refused.log"
if ask_desktop load-shell "$WORK/first/shell.js" >"$REFUSED" 2>&1; then
  echo "FAIL: a shell the engine refused was reported loaded:"
  sed 's/^/    /' "$REFUSED"
  FAILED=1
elif grep -q "no shell window" "$REFUSED"; then
  echo "PASS: $(grep -m1 'no shell window' "$REFUSED")"
else
  echo "FAIL: it failed without the engine's own reason in it:"
  sed 's/^/    /' "$REFUSED"
  FAILED=1
fi

echo "== a path that names no shell is refused before any engine hears it =="
# Answered at the terminal it was typed in, which is the reason `load-shell`
# resolves the path in the client rather than sending the word along.
BEFORE="$(wc -l <"$WORK/engine-heard")"
MISSING="$WORK/missing.log"
if ask_desktop load-shell "$WORK/nothing-here.js" >"$MISSING" 2>&1; then
  echo "FAIL: a shell that is not there was reported loaded:"
  sed 's/^/    /' "$MISSING"
  FAILED=1
elif grep -q "no shell at" "$MISSING" &&
     [ "$(wc -l <"$WORK/engine-heard")" = "$BEFORE" ]; then
  echo "PASS: $(grep -m1 'no shell at' "$MISSING")"
else
  echo "FAIL: it failed for some other reason, or it reached the engine:"
  sed 's/^/    /' "$MISSING"
  FAILED=1
fi

exit "$FAILED"
