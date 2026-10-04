#!/usr/bin/env bash
# The desk's state attributes on `window.domicile` -- battery, idle, lock, both
# themes, clipboard, tray, modifiers -- say what the compositor said, to a
# shell that reads them late.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-desk-state.sh /build/chromium/src
#
# WHY THIS EXISTS. Each of these used to reach a page only as an event, gone if
# nobody was listening yet. Each is now the last thing the compositor said,
# null until it has said anything, so a shell reads and then listens. The
# notifications, extensions and audio attributes are the same code -- the last
# event's payload -- and are left to the shells that read them.
# See docs/architecture/WINDOW-DOMICILE.md.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-desk-state: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-desk-state-broker}"
CONTROL="${CONTROL:-/tmp/domicile-desk-state-control}"
PROFILE="${PROFILE:-/tmp/domicile-desk-state-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-desk-state-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-desk-state-socket.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-desk-state: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-desk-state: no python3, and the compositor's end of the control socket is one"
  exit 77
}

rm -f "$BROKER" "$CONTROL"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-desk-state-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-desk-state: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-desk-state.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD listening" "$ENGINE_LOG" || {
  annotate_from "guard-desk-state: the shell module never ran" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
wait_for_line "$TRIES" "GUARD state " "$ENGINE_LOG"
sleep 1

STATE=$(grep -oE '"GUARD state .*"' "$ENGINE_LOG" | head -1)

FAILURE=$(STATE="$STATE" python3 - <<'PY'
import json, os

line = os.environ["STATE"]
if not line:
    print("the page never read the state, so the module did not run or an attribute threw")
    raise SystemExit
state = json.loads(line[len('"GUARD state '):-1])
wanted = {
    "altKey": True,
    "batteryCharge": 0.5,
    "batteryCharging": True,
    "clipboard": [{"id": 7, "preview": "hello"}],
    "ctrlKey": False,
    "idle": True,
    "locked": False,
    "shiftKey": True,
    "theme": "light",
    "tray": [{"id": "nm", "title": "Network"}],
    "windowsTheme": "dark",
}
wrong = sorted(k for k in wanted if state.get(k) != wanted[k])
if wrong:
    print("the attributes do not say what the compositor said: %s" % ", ".join("%s is %s, wanted %s" % (k, json.dumps(state.get(k)), json.dumps(wanted[k])) for k in wrong))
PY
)

echo "page: $STATE"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-desk-state: $FAILURE" "$ENGINE_LOG"
  echo "guard-desk-state: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: a shell that reads late reads the desk's state"
