#!/usr/bin/env bash
# Tests that `guard-shortcut-chords.js` grabs its chords only once the
# keyboard has reached the page, and that its stand-in says when that is.
#
# A chord grabbed before the keyboard resolves to no key: the page's presses
# go untaken and the untypable chord does not throw. A fixed wait loses that
# race on a busy machine.
#
# - The stand-in sends `idle` after `shell_config`, on the same socket, so
#   `idle` reaching the page means the keyboard has.
# - The page, against a fake host whose `idle` turns true later than any fixed
#   wait would allow, grabs nothing until it does.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
MODULE="$SCRIPTS/guard-shortcut-chords.js"
STAND_IN="$SCRIPTS/guard-shortcut-chords-compositor.py"
for file in "$MODULE" "$STAND_IN"; do
  [ -f "$file" ] || {
    echo "no $file" >&2
    exit 1
  }
done
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: no bun to run the chords guard's module with"
  exit 77
}

WORK="$(mktemp -d)"
STAND_IN_PID=""
cleanup() {
  [ -n "$STAND_IN_PID" ] && kill "$STAND_IN_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# The stand-in's lines after `hello`, by type.
SOCKET="$WORK/control.sock"
python3 "$STAND_IN" --socket "$SOCKET" >"$WORK/stand-in.log" 2>&1 &
STAND_IN_PID=$!
SAID="$(
  python3 - "$SOCKET" <<'EOF'
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
connection.sendall(b'{"protocol_version":1,"type":"hello"}\n')
connection.settimeout(2)
lines = connection.makefile("rb")
types = []
try:
    for line in lines:
        types.append(json.loads(line)["type"])
except socket.timeout:
    pass
print(",".join(types))
EOF
)"
expect "the stand-in says idle after the keyboard" "welcome,shell_config,idle" "$SAID"

# The page against a fake host. Prints when the first grab came, relative to
# the keyboard reaching the page.
HARNESS="$WORK/harness.js"
cat >"$HARNESS" <<'EOF'
// argv: module, ms until the keyboard (and `idle`) reach the page, cap ms.
const [modulePath, keyboardMs, capMs] = process.argv.slice(2);

class KeyboardEvent {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init);
    this.defaultPrevented = false;
  }
}
globalThis.KeyboardEvent = KeyboardEvent;
globalThis.document = { body: { dispatchEvent: () => true } };

let keyboard = false;
const host = {
  addEventListener: () => undefined,
  get idle() {
    return keyboard;
  },
  grabShortcut: () => {
    process.stdout.write(
      keyboard ? "grabbed after the keyboard\n" : "grabbed before the keyboard\n",
    );
    process.exit(0);
  },
};
console.log = () => undefined;
setTimeout(() => {
  keyboard = true;
}, Number(keyboardMs));
setTimeout(() => {
  process.stdout.write("never grabbed\n");
  process.exit(0);
}, Number(capMs));

const { Shell } = await import(modulePath);
Shell(undefined, host);
EOF

expect "the page grabs once the keyboard is there, however late" \
  "grabbed after the keyboard" "$(bun "$HARNESS" "$MODULE" 1500 4000)"

if [ "$FAILED" -eq 0 ]; then
  echo "the chords guard waits for the keyboard"
else
  echo "$FAILED cases failed" >&2
  exit 1
fi
