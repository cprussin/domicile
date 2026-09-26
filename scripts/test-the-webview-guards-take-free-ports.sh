#!/usr/bin/env bash
# Every webview guard runs beside another run of itself.
#
# `crux` is one machine with two runners, and two engine runs' guards overlap.
# /tmp is each runner's own (PrivateTmp); the network is not. The guards used to
# take fixed ports -- 8731-8737 for their pages, 9232-9236 for the debugging
# port -- so PR #603's run 36235045048 on `crux-two` failed five guards at once,
# `OSError: [Errno 98] Address already in use`, while PR #598's run 36235026989
# on `crux` was in the same guards.
#
# So every one of those ports is held here, by a listener that writes down
# anyone who connects -- the other run -- and each guard is started against a
# stand-in engine. What each must do:
#
#   get its page served              the engine was started, and the address it
#                                    was given answers
#   drive the engine it started      `--remote-debugging-port=0`, and the port
#                                    that engine reported is the one asked, and
#                                    never a held one: a second browser on a
#                                    fixed port would take the keys meant for
#                                    this one
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARDS="$ROOT/packages/domicile-engine/scripts"

command -v python3 >/dev/null || {
  echo "SKIP: no python3, which the guards' pages and this test's stand-ins are"
  exit 77
}

WORK="$(mktemp -d)"
HOLDER=""
cleanup() {
  [ -n "$HOLDER" ] && kill "$HOLDER" 2>/dev/null
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

# THE OTHER RUN: every port a guard ever took, held, and anyone who connects
# written down. A port something else on this machine already holds is held all
# the same, which is the condition under test.
python3 - "$WORK/held.log" >"$WORK/holder.log" 2>&1 <<'EOF' &
import selectors, socket, sys

held = sys.argv[1]
chooser = selectors.DefaultSelector()
for port in list(range(8731, 8738)) + list(range(9232, 9237)):
    listener = socket.socket()
    try:
        listener.bind(("127.0.0.1", port))
    except OSError:
        continue
    listener.listen(8)
    chooser.register(listener, selectors.EVENT_READ, port)
print("holding", flush=True)
while True:
    for key, _ in chooser.select():
        connection, _ = key.fileobj.accept()
        with open(held, "a") as log:
            log.write("%d\n" % key.data)
        connection.close()
EOF
HOLDER=$!
for _ in $(seq 1 40); do
  grep -q holding "$WORK/holder.log" && break
  sleep 0.25
done
grep -q holding "$WORK/holder.log" || {
  echo "could not hold the guards' old ports:" >&2
  cat "$WORK/holder.log" >&2
  exit 1
}

# THE ENGINE, standing in: opens its broker socket, asks for the page it was
# pointed at, and -- when asked for a debugging port -- serves one on whatever
# port it gets and says which in its profile, as Chromium does for port 0. Then
# prints every line a guard waits for before it drives, and stays up.
ENGINE="$WORK/engine"
mkdir -p "$ENGINE/out/Domicile"
cat >"$ENGINE/out/Domicile/chrome" <<'EOF'
#!/usr/bin/env python3
import os, re, socket, sys, threading, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

given = dict(a.split("=", 1) for a in sys.argv[1:] if "=" in a)
profile = given["--user-data-dir"]


def record(name, text):
    with open(os.path.join(os.path.dirname(profile), name), "a") as log:
        log.write(text + "\n")


record("engine.args", " ".join(sys.argv[1:]))
broker = socket.socket(socket.AF_UNIX)
broker.bind(given["--domicile-broker-socket"])
broker.listen(1)

page = re.search(r"http://127\.0\.0\.1:[0-9]+[^&]*", given["--app"]).group(0)
try:
    with urllib.request.urlopen(page, timeout=5) as answer:
        record("engine.page", "answered")
except urllib.error.HTTPError:
    record("engine.page", "answered")
except OSError as failure:
    record("engine.page", "no answer at %s: %s" % (page, failure))

if "--remote-debugging-port" in given:

    class Lists(BaseHTTPRequestHandler):
        def do_GET(self):
            record("engine.asked", self.path)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"[]")

        def log_message(self, *_):
            pass

    devtools = ThreadingHTTPServer(
        ("127.0.0.1", int(given["--remote-debugging-port"])), Lists
    )
    threading.Thread(target=devtools.serve_forever, daemon=True).start()
    with open(os.path.join(profile, "DevToolsActivePort"), "w") as active:
        active.write("%d\n/devtools/browser/stand-in\n" % devtools.server_address[1])

for line in ("shell-loaded", "claimed", "guest-loaded", "opener-loaded",
             "page-loaded", "driving"):
    print("GUARD " + line, file=sys.stderr, flush=True)
threading.Event().wait()
EOF
printf '#!/bin/sh\nexit 1\n' >"$ENGINE/out/Domicile/domicile_color_probe"
chmod +x "$ENGINE/out/Domicile/chrome" "$ENGINE/out/Domicile/domicile_color_probe"

# Every guard at once, as `check.sh` runs them, each in a directory of its own.
PIDS=()
for guard in "$GUARDS"/guard-webview-*.sh; do
  name="$(basename "$guard" .sh)"
  run="$WORK/$name"
  mkdir -p "$run/profile"
  env OUT=out/Domicile FOR_SECONDS=2 SETTLE_SECONDS=0 SETTLE_MS=0 SLOW_SECONDS=0 \
    PROFILE="$run/profile" BROKER="$run/broker" CONTROL="$run/control" \
    ENGINE_LOG="$run/engine.log" HTTP_LOG="$run/http.log" \
    CLICK_LOG="$run/click.log" KEY_LOG="$run/key.log" \
    SOCKET_LOG="$run/socket.log" \
    "$guard" "$ENGINE" >"$run/guard.log" 2>&1 &
  PIDS+=($!)
done
wait "${PIDS[@]}"

for guard in "$GUARDS"/guard-webview-*.sh; do
  name="$(basename "$guard" .sh)"
  run="$WORK/$name"
  echo "$name"
  expect "its page is served, beside a run holding its old port" "answered" \
    "$(cat "$run/engine.page" 2>/dev/null || tail -3 "$run/guard.log")"
  if grep -q -- '--remote-debugging-port' "$guard"; then
    expect "its engine picks its own debugging port" "yes" \
      "$(grep -q -- '--remote-debugging-port=0' "$run/engine.args" 2>/dev/null &&
        echo yes || cat "$run/engine.args" 2>/dev/null)"
    expect "and it drives the engine it started" "/json/list" \
      "$(head -1 "$run/engine.asked" 2>/dev/null || tail -3 "$run/guard.log")"
  fi
  echo
done

expect "nothing asked the other run's ports" "" "$(sort -u "$WORK/held.log" 2>/dev/null)"

if [ "$FAILED" -eq 0 ]; then
  echo "every webview guard runs beside another run of itself"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
