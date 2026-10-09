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
# windows appearing, one retitled, given a desktop id, resized, limited and
# given a cursor, one focused, one closed, a popup placed -- and the attributes
# must hold all of it.
# See packages/chrome-sdk/README.md.
#
# AND TWO THINGS NO OTHER GUARD READS IN A REAL ENGINE:
#
#   every event the desktop names reaches both an addEventListener listener
#     and its on<name> handler. The names are the fork's own
#     (modules/domicile/domicile_event_names.h), not Blink's global list, and a
#     name either side lost is a message a shell stops hearing
#   the cursor's closed set: a cursor the engine does not know does NOT reach
#     `windows`, and one it knows, sent after it, does -- so "the bad name was
#     refused" can be told apart from "the channel died on it"
#   the config's appearance: `accentColor`, `highContrast` and
#     `reducedMotion` hold what the compositor's `appearance` line said
#   the relay of the shell's system calls: the page's `callSystem` reaches the
#     compositor wrapped as a `system_request`, one that is not a JSON call
#     never leaves the browser, and a `system_reply` reaches the page whole
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
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
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

# THE CLOSING QUOTE IS LOAD-BEARING. A console line reaches this log wrapped
# by Chromium:
#
#   [...:INFO:CONSOLE:48] "GUARD focused second", source: ...
#
# so a `GUARD` line never ends where the message does, and a reading anchored
# on `$` reads every one as absent. The quote Chromium puts after the message
# is the terminator, and it also keeps these off the engine's own unquoted
# warnings in the same log -- its line about an unknown cursor among them.
NAMES=$(grep -oE '"GUARD names missing=[^"]*"' "$ENGINE_LOG" | head -1)
WINDOWS=$(grep -oE '"GUARD windows .*"' "$ENGINE_LOG" | head -1)
FOCUSED=$(grep -oE '"GUARD focused [^"]*"' "$ENGINE_LOG" | head -1)
APPEARANCE=$(grep -oE '"GUARD appearance [^"]*"' "$ENGINE_LOG" | head -1)
CHANGED=$(grep -oE '"GUARD changed n=[0-9]+"' "$ENGINE_LOG" | head -1)
SYSTEM_IN=$(grep -cE '"GUARD system data=\{"type": ?"system_reply"' "$ENGINE_LOG")
SYSTEM_OUT=$(grep -cE '^said: \{"id":1,"request":\{"call":"stat","path":"/"\},"type":"system_request"\}$' "$SOCKET_LOG")
SYSTEM_LEAKED=$(grep -cE '^said: .*"id":2' "$SOCKET_LOG")

FAILURE=$(NAMES="$NAMES" WINDOWS="$WINDOWS" FOCUSED="$FOCUSED" CHANGED="$CHANGED" \
  APPEARANCE="$APPEARANCE" \
  SYSTEM_IN="$SYSTEM_IN" SYSTEM_OUT="$SYSTEM_OUT" SYSTEM_LEAKED="$SYSTEM_LEAKED" python3 - <<'PY'
import json, os

if os.environ["NAMES"] != '"GUARD names missing=none"':
    print("an event the desktop names did not reach its listener or its on<name> handler (%s), so the fork's names in modules/domicile/domicile_event_names.h and the page disagree" % (os.environ["NAMES"] or "no GUARD names line"))
    raise SystemExit
windows_line = os.environ["WINDOWS"]
if not windows_line:
    print("the page never read `windows`, so the module did not run or the attribute threw")
    raise SystemExit
windows = json.loads(windows_line[len('"GUARD windows '):-1])
by_id = {w["appId"]: w for w in windows}

def default(**fields):
    window = {"cursor": "default", "desktopId": "", "grab": False, "height": None, "maxHeight": None,
              "maxWidth": None, "minHeight": None, "minWidth": None, "parent": None,
              "title": "", "width": None, "x": None, "y": None}
    window.update(fields)
    return window

wanted = [
    default(appId="first", title="Retitled", desktopId="org.example.First", width=800,
            height=600, minWidth=100, minHeight=50, cursor="zoom-out"),
    default(appId="second", title="Second", desktopId="org.example.Second", width=640,
            height=480, cursor="grab"),
    default(appId="menu", parent="second", x=10, y=20, width=120, height=90, grab=True),
]

# THE CURSOR ARMS FIRST, AND IN THIS ORDER. An unknown name reaching the page
# outranks the one after it not reaching it: both can be true at once, and the
# second would then be a false sentence about a run where something did arrive.
if by_id.get("second", {}).get("cursor") not in (None, "grab"):
    print("`second`'s cursor is %s where the compositor's last known shape for it was grab: either the unknown `pointr` after it moved it, and the closed set in components/domicile/common/cursor_shape.h is not being applied, or the grab itself never arrived" % by_id["second"]["cursor"])
elif by_id.get("first", {}).get("cursor") != "zoom-out":
    print("the cursor sent after the unknown one never reached `first` (%s), so the unknown name was not refused but fatal: the channel stopped on it" % by_id.get("first", {}).get("cursor"))
elif [w["appId"] for w in windows] != [w["appId"] for w in wanted]:
    print("`windows` lists %s where the compositor left first, second and menu, in the order they appeared; a closed window kept, or one lost, is a shell drawing the wrong desk" % [w["appId"] for w in windows])
elif windows != wanted:
    wrong = [w["appId"] for w, v in zip(windows, wanted) if w != v]
    print("`windows` has the right windows but not what the compositor said about %s: got %s" % (", ".join(wrong), json.dumps([by_id[i] for i in wrong])))
elif os.environ["FOCUSED"] != '"GUARD focused second"':
    print("`focusedWindow` is %s where the compositor focused second" % os.environ["FOCUSED"])
elif os.environ["APPEARANCE"] != '"GUARD appearance #3584e4 true false"':
    print("the page's appearance is %s where the compositor said #3584e4, high contrast, no reduced motion: ControlChannel or DomicileHost::AppearanceChanged lost it" % (os.environ["APPEARANCE"] or "no GUARD appearance line"))
elif os.environ["CHANGED"] != '"GUARD changed n=0"':
    print("a listener registered after the compositor fell silent heard %s; nothing changed after it subscribed, so the engine is dispatching late or twice" % os.environ["CHANGED"])
elif os.environ["SYSTEM_LEAKED"] != "0":
    print("a callSystem that is not a JSON call reached the compositor, so ControlChannel::CallSystem is not refusing what components/domicile/browser/system_call.h refuses")
elif os.environ["SYSTEM_OUT"] == "0":
    print("the page's callSystem never reached the compositor as a system_request wrapping it: Blink's callSystem, ControlChannel::CallSystem or SystemRequestLine lost or reshaped it")
elif os.environ["SYSTEM_IN"] == "0":
    print("a system_reply sent down the control socket never reached the page as a system event: the browser did not relay it, or Blink did not dispatch it")
PY
)

echo "page: $NAMES $WINDOWS $FOCUSED $APPEARANCE $CHANGED"
echo "system: out=$SYSTEM_OUT leaked=$SYSTEM_LEAKED in=$SYSTEM_IN"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-windows-state: $FAILURE" "$ENGINE_LOG"
  echo "guard-windows-state: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: a shell that reads late reads the whole desk, every event name fires, the cursor set is closed and system calls cross the browser"
