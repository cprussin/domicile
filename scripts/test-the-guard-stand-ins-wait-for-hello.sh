#!/usr/bin/env bash
# Asserts every engine guard's compositor stand-in says nothing until the
# browser's `hello`, and answers it.
#
# The real compositor waits for `hello`. A stand-in that writes first races the
# page binding its end of the channel, and the browser drops page-bound lines
# that win that race.
#
# STAND_INS overrides the directory, so the test can run against another copy.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAND_INS="${STAND_INS:-$ROOT/packages/domicile-engine/scripts}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
COUNT=0
for script in "$STAND_INS"/*-compositor.py "$STAND_INS"/guard-webview-keyboard-socket.py; do
  COUNT=$((COUNT + 1))
  name="$(basename "$script")"
  socket="$WORK/$name.sock"
  python3 "$script" --socket "$socket" >"$WORK/$name.log" 2>&1 &
  pid=$!
  got="$(
    python3 - "$socket" <<'EOF'
import json, socket, sys, time

path = sys.argv[1]
for _ in range(100):
    try:
        connection = socket.socket(socket.AF_UNIX)
        connection.connect(path)
        break
    except OSError:
        time.sleep(0.05)
else:
    print("never listened")
    sys.exit()
connection.settimeout(2)
try:
    early = connection.recv(65536)
except socket.timeout:
    early = b""
if early:
    print("spoke before hello: %s" % early.decode("utf-8", "replace").split("\n")[0])
    sys.exit()
connection.sendall(b'{"protocol_version":1,"type":"hello"}\n')
connection.settimeout(5)
first = connection.makefile("rb").readline()
print(json.loads(first)["type"] if first else "no answer to hello")
EOF
  )"
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  want="welcome"
  [ "$name" = "guard-webview-keyboard-socket.py" ] && want="shell_config"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$name"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$name" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
done

if [ "$COUNT" -lt 2 ]; then
  echo "found $COUNT stand-ins in $STAND_INS" >&2
  exit 1
elif [ "$FAILED" -eq 0 ]; then
  echo "every stand-in waits for hello"
else
  echo "$FAILED stand-ins did not wait for hello" >&2
  exit 1
fi
