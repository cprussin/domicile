#!/usr/bin/env bash
# A desktop running on a config module takes an edit to it: the config is
# evaluated again into the file the compositor reads, and — the config being
# the shell — built again and loaded.
#
#   ./scripts/test-a-config-module-reloads.sh
#
# `tests/config_watch.rs` owns the watch and `test-a-running-desktop-takes-a-
# new-shell.sh` the load; this owns the join: that `domicile` with no shell
# runs the config's, hands the compositor the evaluation at a path that stays
# put, and on an edit evaluates and builds again and tells the engine.
#
# THE BUILDER HERE IS A FEW LINES OF SHELL, standing in for `@domicile-desktop/builder`
# — whose own tests build and evaluate for real — as the engine and the
# compositor stand in for theirs: what is under test is the supervisor.
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

WORK="$(mktemp -d)"
DESKTOP=""
cleanup() {
  [ -n "$DESKTOP" ] && { kill "$DESKTOP" 2>/dev/null; wait "$DESKTOP" 2>/dev/null; }
  pkill -f "$WORK/engine/chrome" 2>/dev/null
  pkill -f "$WORK/domicile-compositor" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# The config, which is the shell: what it says is a version the fake builder
# carries through into both what it evaluates and where it builds.
mkdir -p "$WORK/config/domicile"
CONFIG="$WORK/config/domicile/domicile.ts"
echo "first" >"$CONFIG"

# The builder: evaluates a config into JSON carrying its text, and builds an
# entry into a directory named after its text, one JSON line each.
cat >"$WORK/builder" <<'BUILDER'
#!/usr/bin/env bash
mode="$1" target="$2" cache=""
while [ $# -gt 0 ]; do [ "$1" = --cache ] && cache="$2"; shift; done
said="$(cat "$target")"
case "$mode" in
  --evaluate)
    mkdir -p "$cache/configs"
    out="$cache/configs/$said.json"
    printf '{"said":"%s"}\n' "$said" >"$out"
    printf '{"step":"evaluated","config":"%s","cached":false}\n' "$out" ;;
  --entry)
    mkdir -p "$cache/$said"
    : >"$cache/$said/shell.js"
    printf '{"step":"built","root":"%s","module":"shell.js","cached":false}\n' "$cache/$said" ;;
esac
BUILDER
chmod +x "$WORK/builder"

mkdir -p "$WORK/engine"
cat >"$WORK/engine/chrome" <<ENGINE
#!/usr/bin/env python3
import json, socket, sys

broker = command = None
for arg in sys.argv[1:]:
    if arg.startswith("--domicile-broker-socket="):
        broker = arg.split("=", 1)[1]
    elif arg.startswith("--domicile-command-socket="):
        command = arg.split("=", 1)[1]
with open("$WORK/engine-argv", "w") as saying:
    saying.write("\n".join(sys.argv[1:]))
listening = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
listening.bind(command)
listening.listen(4)
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
    connection.sendall(b'{"type":"loaded"}\n')
    connection.close()
ENGINE
chmod +x "$WORK/engine/chrome"

cat >"$WORK/domicile-compositor" <<COMPOSITOR
#!/bin/sh
printf '%s\n' "\$@" >"$WORK/compositor-argv"
while [ \$# -gt 0 ]; do
  case "\$1" in --session) session="\$2"; shift ;; esac
  shift
done
: >"\$session"
exec sleep 60
COMPOSITOR
chmod +x "$WORK/domicile-compositor"

mkdir -p "$WORK/runtime"
LOG="$WORK/desktop.log"
env OZONE=headless \
    XDG_RUNTIME_DIR="$WORK/runtime" \
    XDG_CONFIG_HOME="$WORK/config" \
    XDG_CACHE_HOME="$WORK/cache" \
    DOMICILE_ENGINE="$WORK/engine" \
    DOMICILE_COMPOSITOR="$WORK/domicile-compositor" \
    DOMICILE_BUILDER="$WORK/builder" \
    "$DOMICILE" >"$LOG" 2>&1 &
DESKTOP=$!

WAITED=0
while ! grep -q "domicile is up" "$LOG" 2>/dev/null; do
  if [ "$WAITED" -ge 100 ]; then
    echo "FAIL: the desktop never came up. What it said:"
    sed 's/^/    /' "$LOG"
    exit 1
  fi
  sleep 0.1
  WAITED=$((WAITED + 1))
done

FAILED=0

echo "== the shell is the config's, built =="
SERVED="$(sed -n 's/^--domicile-shell-root=//p' "$WORK/engine-argv")"
if [ "$SERVED" = "$WORK/cache/domicile/shells/first" ]; then
  echo "PASS: $SERVED"
else
  echo "FAIL: the engine serves '$SERVED'"
  FAILED=1
fi

echo "== the compositor reads the evaluation, at a path that stays put =="
READS="$(grep -A1 -x -- --config "$WORK/compositor-argv" | tail -n 1)"
case "$READS" in
  "$WORK/runtime/"*/config.json)
    if grep -q '"said":"first"' "$READS"; then
      echo "PASS: $READS"
    else
      echo "FAIL: $READS says $(cat "$READS")"
      FAILED=1
    fi ;;
  *)
    echo "FAIL: the compositor was given --config '$READS'"
    FAILED=1 ;;
esac

echo "== an edit is evaluated again and the shell built again and loaded =="
echo "second" >"$CONFIG"
WAITED=0
while ! grep -q "reloaded" "$LOG" 2>/dev/null && [ "$WAITED" -lt 100 ]; do
  sleep 0.1
  WAITED=$((WAITED + 1))
done
if grep -q '"said":"second"' "$READS" 2>/dev/null; then
  echo "PASS: the compositor's config says $(cat "$READS")"
else
  echo "FAIL: the compositor's config says $(cat "$READS" 2>/dev/null)"
  FAILED=1
fi
WANT="{\"type\":\"load_shell\",\"version\":1,\"root\":\"$WORK/cache/domicile/shells/second\",\"module\":\"shell.js\"}"
if grep -qxF "$WANT" "$WORK/engine-heard" 2>/dev/null; then
  echo "PASS: the engine was told $WANT"
else
  echo "FAIL: the engine heard:"
  sed 's/^/    /' "$WORK/engine-heard" 2>/dev/null
  echo "    and the desktop said:"
  sed 's/^/    /' "$LOG"
  FAILED=1
fi

exit "$FAILED"
