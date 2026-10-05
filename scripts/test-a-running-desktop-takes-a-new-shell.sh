#!/usr/bin/env bash
# Checks a running desktop loads a new shell, opens URLs and takes screenshots
# on command, via `domicile load-shell`, `BROWSER`, the `xdg-open` shim on its
# apps' PATH, and `domicile screenshot`.
#
#   ./scripts/test-a-running-desktop-takes-a-new-shell.sh
#
# Unit tests cover the parts: `tests/cli.rs` the arguments, `tests/command.rs`
# the line sent, `tests/command_socket.rs` the reply. This covers the wiring:
# the supervisor gives the engine a command socket, a command from another
# terminal reaches it over DOMICILE_SOCK, and a refusal is printed in that
# terminal.
#
# The engine is a small Python stub of the command socket. The real side,
# `components/domicile/browser/command_protocol.cc`, has its own unit tests.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${CARGO_TARGET_DIR:-$ROOT/target}"

command -v cargo >/dev/null 2>&1 || { echo "SKIP: no cargo"; exit 77; }
command -v python3 >/dev/null 2>&1 || {
  echo "SKIP: no python3, which is what binds the engine's command socket here"
  exit 77
}

echo "== building domicile =="
( cd "$ROOT" && cargo build -q -p domicile-launch --bins ) || {
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

# The starting shell and the one to load. Never run, but must exist for the
# paths to resolve.
mkdir -p "$WORK/first" "$WORK/second"
: >"$WORK/first/shell.js"
: >"$WORK/second/shell.js"

# The stub engine's next answer, read per connection, so one desktop can test
# both success and refusal.
echo loaded >"$WORK/answer"

# Stub engine: creates the broker socket, binds the command socket, and
# answers one line per connection, as the real engine does.
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

# Record the arguments for the test to check.
with open("$WORK/engine-argv", "w") as saying:
    saying.write("\n".join(sys.argv[1:]))

if command is None:
    # Fail fast so the desktop does not come up without a command socket.
    sys.exit("no --domicile-command-socket")

listening = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
listening.bind(command)
listening.listen(4)
# After the bind, so the command socket is ready once the broker appears.
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
    done = ({"type": "opened"} if b'"type":"open_url"' in line
            else {"type": "captured"} if b'"type":"screenshot"' in line
            else {"type": "loaded"})
    reply = (done if answer == "loaded"
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
# Record the environment apps inherit, for the test to check.
printf '%s' "$BROWSER" >"$(dirname "$session")/browser"
printf '%s' "$PATH" >"$(dirname "$session")/path"
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

# Runs a `domicile` command as a terminal inside the desktop would.
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
# The supervisor must update the served shell after a load.
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
# `load-shell` resolves the path in the client, so the error is local and the
# engine never sees it.
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

echo "== screenshot reaches the engine with the file made absolute =="
# The engine does not share the terminal's working directory.
echo loaded >"$WORK/answer"
SAID="$(cd "$WORK" && ask_desktop screenshot shot.png)"
HEARD="$(tail -n 1 "$WORK/engine-heard" 2>/dev/null)"
WANT="{\"type\":\"screenshot\",\"version\":1,\"file\":\"$WORK/shot.png\"}"
if [ "$HEARD" = "$WANT" ]; then
  echo "PASS: $HEARD"
else
  echo "FAIL: the engine heard '$HEARD'"
  echo "      and the protocol says  $WANT"
  FAILED=1
fi

echo "== and the terminal is told where the screenshot is =="
if [ "$SAID" = "$WORK/shot.png" ]; then
  echo "PASS: $SAID"
else
  echo "FAIL: screenshot said '$SAID', and it wrote $WORK/shot.png"
  FAILED=1
fi

echo "== the apps a desktop starts are handed domicile-open-url as BROWSER =="
BROWSER_WAS="$(cat "$(dirname "$GIVEN")/browser" 2>/dev/null)"
if [ "$BROWSER_WAS" = "$TARGET/debug/domicile-open-url" ]; then
  echo "PASS: $BROWSER_WAS"
else
  echo "FAIL: the compositor was given BROWSER='$BROWSER_WAS', and the program"
  echo "      beside domicile is $TARGET/debug/domicile-open-url"
  FAILED=1
fi

echo "== BROWSER reaches the engine as the line the protocol says it is =="
# Run BROWSER as an app would, with one argument. A relative path becomes a
# file URL against the working directory.
echo loaded >"$WORK/answer"
if ! ( cd "$WORK" && env DOMICILE_SOCK="$SOCK" "$TARGET/debug/domicile-open-url" \
         "first/a page.html" ) >"$WORK/opened.log" 2>&1; then
  echo "FAIL: domicile-open-url failed:"
  sed 's/^/    /' "$WORK/opened.log"
  FAILED=1
fi
HEARD="$(tail -n 1 "$WORK/engine-heard" 2>/dev/null)"
WANT="{\"type\":\"open_url\",\"version\":1,\"url\":\"file://$WORK/first/a%20page.html\"}"
if [ "$HEARD" = "$WANT" ]; then
  echo "PASS: $HEARD"
else
  echo "FAIL: the engine heard '$HEARD'"
  echo "      and the protocol says  $WANT"
  FAILED=1
fi

echo "== xdg-open, for the apps a desktop starts, is the desktop's =="
APP_PATH="$(cat "$(dirname "$GIVEN")/path" 2>/dev/null)"
SHIMS="${APP_PATH%%:*}"
if [ "$(readlink "$SHIMS/xdg-open")" = "$TARGET/debug/domicile-xdg-open" ]; then
  echo "PASS: $SHIMS/xdg-open"
else
  echo "FAIL: the first directory on the apps' PATH is '$SHIMS', and its xdg-open"
  echo "      is not $TARGET/debug/domicile-xdg-open"
  FAILED=1
fi

echo "== a link handed to that xdg-open reaches the engine =="
if ! env DOMICILE_SOCK="$SOCK" PATH="$APP_PATH" xdg-open "https://example.com/" \
       >"$WORK/xdg-opened.log" 2>&1; then
  echo "FAIL: xdg-open failed:"
  sed 's/^/    /' "$WORK/xdg-opened.log"
  FAILED=1
fi
HEARD="$(tail -n 1 "$WORK/engine-heard" 2>/dev/null)"
WANT='{"type":"open_url","version":1,"url":"https://example.com/"}'
if [ "$HEARD" = "$WANT" ]; then
  echo "PASS: $HEARD"
else
  echo "FAIL: the engine heard '$HEARD'"
  echo "      and the protocol says  $WANT"
  FAILED=1
fi

echo "== and anything else reaches the xdg-open behind it =="
# A stub system xdg-open, which handles non-URL arguments.
mkdir -p "$WORK/system"
cat >"$WORK/system/xdg-open" <<SYSTEM
#!/bin/sh
printf '%s\n' "\$@" >"$WORK/system-heard"
SYSTEM
chmod +x "$WORK/system/xdg-open"
env DOMICILE_SOCK="$SOCK" PATH="$SHIMS:$WORK/system:$APP_PATH" xdg-open notes.pdf \
  >"$WORK/deferred.log" 2>&1
if [ "$(cat "$WORK/system-heard" 2>/dev/null)" = "notes.pdf" ]; then
  echo "PASS: notes.pdf went to $WORK/system/xdg-open"
else
  echo "FAIL: notes.pdf did not reach the xdg-open behind this desktop's:"
  sed 's/^/    /' "$WORK/deferred.log"
  FAILED=1
fi

exit "$FAILED"
