#!/usr/bin/env bash
# Tests that `guard-windows-state.js` reads the desk only once its stand-in
# has said everything, and still reads when the channel stops partway.
#
# A fixed wait loses to a stand-in that starts late on a busy machine: the
# page reads mid-sequence and the verdict blames the channel.
#
# - The stand-in sends `system_reply` last, on the same socket, so the reply
#   reaching the page means every window message has.
# - The page, against a fake host whose reply comes later than any fixed wait
#   would allow, reads the state the reply follows.
# - The page, against a host whose reply never comes, still reads before
#   `guard-windows-state.sh` stops waiting, so its verdict can name the cursor.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
MODULE="$SCRIPTS/guard-windows-state.js"
STAND_IN="$SCRIPTS/guard-windows-state-compositor.py"
for file in "$MODULE" "$STAND_IN"; do
  [ -f "$file" ] || {
    echo "no $file" >&2
    exit 1
  }
done
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: no bun to run the windows-state guard's module with"
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

# The type of the stand-in's last line after `hello`.
SOCKET="$WORK/control.sock"
python3 "$STAND_IN" --socket "$SOCKET" >"$WORK/stand-in.log" 2>&1 &
STAND_IN_PID=$!
LAST="$(
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
types = []
try:
    for line in connection.makefile("rb"):
        types.append(json.loads(line)["type"])
except socket.timeout:
    pass
print(types[-1] if types else "nothing")
EOF
)"
expect "the stand-in says system_reply last" "system_reply" "$LAST"

# The page against a fake host on a virtual clock. Prints `first`'s cursor as
# the page read it and when, or that it never read before the guard's
# 60-second wait ran out.
HARNESS="$WORK/harness.js"
cat >"$HARNESS" <<'EOF'
// argv: module, ms until the stand-in's reply reaches the page, or `never`.
const [modulePath, replyAt] = process.argv.slice(2);
const DEADLINE = 60000;

let now = 0;
const timers = [];
globalThis.setTimeout = (fn, ms) => {
  timers.push({ at: now + ms, fn });
};

let said = false;
const listeners = {};
const host = {
  accentColor: "",
  addEventListener: (name, fn) => {
    listeners[name] = [...(listeners[name] ?? []), fn];
  },
  callSystem: () => undefined,
  dispatchEvent: (event) => {
    for (const fn of listeners[event.type] ?? []) {
      fn(event);
    }
  },
  focusedWindow: null,
  highContrast: false,
  reducedMotion: false,
  removeEventListener: () => undefined,
  syncFrames: () => undefined,
  get windows() {
    return [{ appId: "first", cursor: said ? "zoom-out" : "default" }];
  },
};
if (replyAt !== "never") {
  timers.push({
    at: Number(replyAt),
    fn: () => {
      said = true;
      host.dispatchEvent({ data: "{}", isTrusted: true, type: "system" });
    },
  });
}

console.log = (line) => {
  if (line.startsWith("GUARD windows ")) {
    const [first] = JSON.parse(line.slice("GUARD windows ".length));
    process.stdout.write(`read ${first.cursor} at ${now}\n`);
    process.exit(0);
  }
};

const { Shell } = await import(modulePath);
Shell(undefined, host);
while (timers.length > 0) {
  timers.sort((a, b) => a.at - b.at);
  const next = timers.shift();
  if (next.at > DEADLINE) {
    break;
  }
  now = next.at;
  next.fn();
}
process.stdout.write("never read\n");
EOF

expect "the page reads once the reply is there, however late" \
  "read zoom-out at 20000" "$(bun "$HARNESS" "$MODULE" 20000)"
GOT="$(bun "$HARNESS" "$MODULE" never)"
expect "the page reads what it has when the reply never comes" \
  "read default" "${GOT% at *}"

if [ "$FAILED" -eq 0 ]; then
  echo "the windows-state guard waits for its stand-in"
else
  echo "$FAILED cases failed" >&2
  exit 1
fi
