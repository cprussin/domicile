#!/usr/bin/env bash
# `domicile.windows` and `focusedWindow` say what the compositor said,
# to a shell that reads them late.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-windows-state.sh /build/chromium/src
#
# WHY THIS EXISTS. An event dispatched before a listener exists is gone. With
# the state as attributes there is nothing to buffer: the page reads, then
# listens. This
# guard's page reads only after the stand-in has said everything -- three
# windows appearing, one retitled, resized, limited and given a cursor, one
# focused, one closed, a popup placed -- and the attributes must hold all of it.
# See docs/architecture/WINDOW-DOMICILE.md.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-windows-state: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-windows-state-broker}"
CONTROL="${CONTROL:-/tmp/domicile-windows-state-control}"
PROFILE="${PROFILE:-/tmp/domicile-windows-state-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-windows-state-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-windows-state-socket.log}"
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
  annotate "guard-windows-state: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-windows-state: no python3, and the compositor's end of the control socket is one"
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
python3 "$SCRIPTS/guard-windows-state-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-windows-state: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-windows-state.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD listening" "$ENGINE_LOG" || {
  annotate_from "guard-windows-state: the shell module never ran" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
wait_for_line "$TRIES" "GUARD changed n=" "$ENGINE_LOG"
sleep 1

# The closing quote is Chromium's and keeps each match on the message: see
# guard-control-arrival.sh.
WINDOWS=$(grep -oE '"GUARD windows .*"' "$ENGINE_LOG" | head -1)
FOCUSED=$(grep -oE '"GUARD focused [^"]*"' "$ENGINE_LOG" | head -1)
CHANGED=$(grep -oE '"GUARD changed n=[0-9]+"' "$ENGINE_LOG" | head -1)

FAILURE=$(WINDOWS="$WINDOWS" FOCUSED="$FOCUSED" CHANGED="$CHANGED" python3 - <<'PY'
import json, os

windows_line = os.environ["WINDOWS"]
if not windows_line:
    print("the page never read `windows`, so the module did not run or the attribute threw")
    raise SystemExit
windows = json.loads(windows_line[len('"GUARD windows '):-1])
by_id = {w["appId"]: w for w in windows}

def default(**fields):
    window = {"cursor": "default", "grab": False, "height": None, "maxHeight": None,
              "maxWidth": None, "minHeight": None, "minWidth": None, "parent": None,
              "title": "", "width": None, "x": None, "y": None}
    window.update(fields)
    return window

wanted = [
    default(appId="first", title="Retitled", width=800, height=600, minWidth=100, minHeight=50),
    default(appId="second", title="Second", width=640, height=480, cursor="grab"),
    default(appId="menu", parent="second", x=10, y=20, width=120, height=90, grab=True),
]

if [w["appId"] for w in windows] != [w["appId"] for w in wanted]:
    print("`windows` lists %s where the compositor left first, second and menu, in the order they appeared; a closed window kept, or one lost, is a shell drawing the wrong desk" % [w["appId"] for w in windows])
elif windows != wanted:
    wrong = [w["appId"] for w, v in zip(windows, wanted) if w != v]
    print("`windows` has the right windows but not what the compositor said about %s: got %s" % (", ".join(wrong), json.dumps([by_id[i] for i in wrong])))
elif os.environ["FOCUSED"] != '"GUARD focused second"':
    print("`focusedWindow` is %s where the compositor focused second" % os.environ["FOCUSED"])
elif os.environ["CHANGED"] != '"GUARD changed n=0"':
    print("a listener registered after the compositor fell silent heard %s; nothing changed after it subscribed, so the engine is dispatching late or twice" % os.environ["CHANGED"])
PY
)

echo "page: $WINDOWS $FOCUSED $CHANGED"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-windows-state: $FAILURE" "$ENGINE_LOG"
  echo "guard-windows-state: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: a shell that reads late reads the whole desk"
