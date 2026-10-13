#!/usr/bin/env bash
# Tests that `guard-webview-keyboard.js` claims Alt+Tab only once the keyboard
# has reached the page, and that its stand-in says when that is.
#
# A chord claimed before the keyboard reaches the browser's registry only when
# the keyboard arrives. Pressed before that, Alt+Tab goes to the guest and comes
# back as an unclaimed `guest-chord`, and the guard blames the hook.
#
# - The stand-in sends `idle` after `shell_config`, on the same socket, so
#   `idle` reaching the page means the keyboard has.
# - The page, against a fake host whose `idle` turns true late, claims nothing
#   until it does.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
MODULE="$SCRIPTS/guard-webview-keyboard.js"
STAND_IN="$SCRIPTS/guard-webview-keyboard-socket.py"
for file in "$MODULE" "$STAND_IN"; do
  [ -f "$file" ] || {
    echo "no $file" >&2
    exit 1
  }
done
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: no bun to run the keyboard guard's module with"
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
expect "the stand-in says idle after the keyboard" "shell_config,idle" "$SAID"

# The page against a fake host and document. Prints when the claim came,
# relative to the keyboard reaching the page, and when the page said so.
HARNESS="$WORK/harness.js"
cat >"$HARNESS" <<'EOF'
// argv: module, ms until the keyboard (and `idle`) reach the page, cap ms.
const [modulePath, keyboardMs, capMs] = process.argv.slice(2);

const element = () => ({
  style: {},
  addEventListener: () => undefined,
  setAttribute: () => undefined,
  focus: () => undefined,
});
globalThis.location = { search: "?kind=webview&src=http://127.0.0.1/page" };
globalThis.document = {
  activeElement: undefined,
  addEventListener: () => undefined,
  body: { append: () => undefined },
  createElement: element,
};

let keyboard = false;
let claimed = false;
const host = {
  addEventListener: () => undefined,
  get idle() {
    return keyboard;
  },
  grabShortcut: () => {
    claimed = true;
    process.stdout.write(
      keyboard ? "claimed after the keyboard\n" : "claimed before the keyboard\n",
    );
  },
};
console.log = (line) => {
  if (line.startsWith("GUARD claimed")) {
    process.stdout.write(
      claimed ? "said so after claiming\n" : "said so before claiming\n",
    );
    process.exit(0);
  }
};
setTimeout(() => {
  keyboard = true;
}, Number(keyboardMs));
setTimeout(() => {
  process.stdout.write("never claimed\n");
  process.exit(0);
}, Number(capMs));

const { Shell } = await import(modulePath);
Shell(undefined, host);
EOF

expect "the page claims once the keyboard is there, however late" \
  "claimed after the keyboard
said so after claiming" "$(bun "$HARNESS" "$MODULE" 1500 4000)"

if [ "$FAILED" -eq 0 ]; then
  echo "the keyboard guard waits for the keyboard"
else
  echo "$FAILED cases failed" >&2
  exit 1
fi
