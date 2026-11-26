#!/usr/bin/env bash
# An unpacked extension loaded again reloads in every browser profile.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-extension-reload.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the pages' console lines from the engine's log, so it needs no pixels and no
# client.
#
# WHY THIS EXISTS. `domicile load-extension` and the Settings app send
# `load_unpacked` to the engine's command socket, again after each edit. Each
# browser profile runs its own copy of an extension, so the edit has to reach
# every one (BrowserProfileRegistry::ReloadUnpackedElsewhere).
#
# The stand-in compositor sends profiles `default` and `work`, with
# `localhost` in `work`. The shell opens the same page at 127.0.0.1 and at
# localhost, and reloads both every second. The guard loads the fixture, loads
# it again after an edit, and then loads a copy of it with another edit from
# another directory: its manifest's `key` makes that the same extension.
# Asserted:
#
#   the shell page ran           or nothing was set up
#   a window in each profile     as the shell's list says
#   `loaded_unpacked` each time  the engine's answers
#   each edit ran in each page   in order, at both hosts
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the same first load, and the
# same edit with no second `load_unpacked`. Neither page may run the edit, so
# the claim's edits ran because of the command.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-extension-reload: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 never sends the second load. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="reloaded"
[ "$NEGATIVE" = "1" ] && MODE="edited"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-extension-reload$WHICH-broker}"
CONTROL="${CONTROL:-/tmp/domicile-extension-reload$WHICH-control}"
COMMAND="${COMMAND:-/tmp/domicile-extension-reload$WHICH-command}"
PROFILE="${PROFILE:-/tmp/domicile-extension-reload$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-extension-reload$WHICH-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-extension-reload$WHICH-socket.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-extension-reload$WHICH-http.log}"
ANSWERS="${ANSWERS:-/tmp/domicile-extension-reload$WHICH-answers.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"
# How long the control leaves the edit on disk, over several page loads.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"
# Without a size the headless window's viewport is empty, so the <webview>s are
# out of it and their pages are hidden.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# The fixture, copied so the guard can edit it, and where its copy moves to.
EXTENSIONS="$(mktemp -d)"
FIRST_HOME="$EXTENSIONS/first-home"
SECOND_HOME="$EXTENSIONS/second-home"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -f "$COMMAND"
  rm -rf "$EXTENSIONS"
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-extension-reload: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-extension-reload: no python3, which serves the page and both sockets' other ends"
  exit 77
}

fresh_broker
rm -f "$CONTROL" "$COMMAND" "$ANSWERS"
rm -rf "$PROFILE"; mkdir -p "$PROFILE"
cp -r "$SCRIPTS/guard-extension-reload-extension" "$FIRST_HOME"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

TRIES=$((FOR_SECONDS * 4))
# Waits for a page at each host to run edit $1.
wait_for_edit() {
  wait_for_line "$TRIES" "GUARD extension=$1 at=127.0.0.1" "$ENGINE_LOG" &&
    wait_for_line "$TRIES" "GUARD extension=$1 at=localhost" "$ENGINE_LOG"
}

# Writes edit $2 of the extension in $1.
edit() {
  printf 'document.documentElement.dataset.extension = "%s";\n' "$2" \
    >"$1/content.js"
}

# Sends `load_unpacked` for directory $1 to the engine's command socket, and
# keeps and prints its answer.
load() {
  python3 - "$COMMAND" "$1" <<'PY' 2>&1 | tee -a "$ANSWERS"
import json, socket, sys

line = json.dumps({"type": "load_unpacked", "version": 1, "directory": sys.argv[2]})
try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(10)
    connection.connect(sys.argv[1])
    connection.sendall((line + "\n").encode())
    print(connection.makefile().readline().strip())
except OSError as failure:
    print("no answer: %s" % failure)
PY
}

# Switches extension $1 on in browser profile $2 through the command socket,
# as the Settings app does once the user picks the profiles: an extension the
# user loads starts off everywhere. Tries until the profile has its copy,
# which another profile's load installs a moment later.
switch_on() {
  python3 - "$COMMAND" "$1" "$2" <<'PY' 2>&1 | tee -a "$ANSWERS"
import json, socket, sys, time

line = json.dumps({"type": "set_extension_enabled", "version": 1,
                   "id": sys.argv[2], "enabled": True, "profile": sys.argv[3]})
answer = "no answer"
for _ in range(120):
    try:
        connection = socket.socket(socket.AF_UNIX)
        connection.settimeout(10)
        connection.connect(sys.argv[1])
        connection.sendall((line + "\n").encode())
        answer = connection.makefile().readline().strip()
    except OSError as failure:
        answer = "no answer: %s" % failure
    if answer.startswith('{"type":"set"') or '"type":"set"' in answer:
        break
    time.sleep(0.25)
print(answer)
PY
}

# 1. The page, on its own server like every <webview> guard's: `crux` reaches
#    no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-extension-reload-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-extension-reload: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-extension-reload: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}

# 2. The compositor's end, with the profiles and no extensions of its own.
PROFILES="{\"profiles\": [\
{\"id\": \"default\", \"name\": \"Default\", \"color\": \"#0d9488\", \
\"private\": false, \"extensions\": null}, \
{\"id\": \"work\", \"name\": \"Work\", \"color\": \"#d97706\", \
\"private\": false, \"extensions\": null}, \
{\"id\": \"private\", \"name\": \"Private\", \"color\": \"#a78bfa\", \
\"private\": true, \"extensions\": null}], \
\"default_profile\": \"default\", \"default_private_profile\": \"private\", \
\"sites\": {\"localhost\": \"work\"}}"
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --browser-profiles "$PROFILES" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-extension-reload: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

# 3. The engine. The addresses are URLs, whose own `?` and `&` an encoded `:`
#    and `/` keep out of the shell's.
FIRST="http%3A%2F%2F127.0.0.1%3A$PORT%2Fpage"
SECOND="http%3A%2F%2Flocalhost%3A$PORT%2Fpage"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size="$WIDTH,$HEIGHT" \
  --app="domicile://shell/?first=$FIRST&second=$SECOND" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-extension-reload.js" \
  --domicile-control-socket="$CONTROL" \
  --domicile-command-socket="$COMMAND" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 4. The loads, each once the pages run the edit before it.
if wait_for_edit none; then
  ID="$(load "$FIRST_HOME" | python3 -c 'import json, sys; print(json.loads(sys.stdin.readline() or "{}").get("id", ""))' 2>/dev/null)"
  switch_on "$ID" default
  switch_on "$ID" work
  if wait_for_edit first; then
    edit "$FIRST_HOME" second
    if [ "$NEGATIVE" = "1" ]; then
      sleep "$SETTLE_SECONDS"
    else
      load "$FIRST_HOME"
      if wait_for_edit second; then
        cp -r "$FIRST_HOME" "$SECOND_HOME"
        edit "$SECOND_HOME" third
        load "$SECOND_HOME"
        wait_for_edit third
      fi
    fi
  fi
fi

# Whether the shell ran, the profiles its windows are in, and the edits each
# host's page ran, in the order each first did. A reload leaves a moment with
# no extension, so a page that runs none again says nothing.
READ="$(awk '
  /GUARD shell-loaded/ { shell = 1 }
  match($0, /GUARD profile=[a-z0-9-]*/) {
    profile = substr($0, RSTART + 14, RLENGTH - 14)
    if (!(profile in profiles)) { profiles[profile] = 1 }
  }
  match($0, /GUARD extension=[a-z]+ at=[a-z0-9.]+/) {
    split(substr($0, RSTART + 16, RLENGTH - 16), said, " at=")
    if (!((said[2], said[1]) in seen)) {
      seen[said[2], said[1]] = 1
      ran[said[2]] = ran[said[2]] (ran[said[2]] == "" ? "" : ",") said[1]
    }
  }
  END {
    printf "%d %d%d %s %s\n", shell, ("default" in profiles),
      ("work" in profiles),
      (ran["127.0.0.1"] == "" ? "-" : ran["127.0.0.1"]),
      (ran["localhost"] == "" ? "-" : ran["localhost"])
  }' "$ENGINE_LOG" 2>/dev/null)"
LOADED="$(grep -cF '"loaded_unpacked"' "$ANSWERS" 2>/dev/null)"

MEASURED="$MODE $READ ${LOADED:-0}"
echo
echo "measured: $MEASURED"
echo "  (mode shell windows-in-default-and-work edits-in-default edits-in-work loads-answered)"

# Which end to blame. `packages/domicile-engine/tests/test-extension-reload-guard.sh`
# runs the reading and this block directly.
FAILURE=""
PASSED=""
case "$MEASURED" in
"reloaded 1 11 none,first,second,third none,first,second,third 3")
  PASSED="an unpacked extension loaded again ran its edit in both browser \
profiles, from its own directory and from another"
  ;;
"edited 1 11 none,first none,first 1")
  PASSED="the control is sharp: the same edit with no second load_unpacked \
ran in neither profile -- so the claim's edits ran because of the command"
  ;;
"reloaded 0 "* | "edited 0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
"reloaded 1 00 "* | "reloaded 1 01 "* | "reloaded 1 10 "* | \
  "edited 1 00 "* | "edited 1 01 "* | "edited 1 10 "*)
  FAILURE="there was no window in each profile, so no two profiles to \
compare: openBrowserWindow opened no window, or routing did not put localhost \
in work (ProfileForUrl)"
  ;;
"reloaded 1 11 - "* | "edited 1 11 - "* | "reloaded 1 11 "*" - "* | \
  "edited 1 11 "*" - "*)
  FAILURE="a window's page never loaded, so nothing was sent: the server did \
not answer, or the <webview> drew no page"
  ;;
"reloaded 1 11 none none "* | "edited 1 11 none none "*)
  FAILURE="the first load_unpacked reached no profile: the engine refused it, \
or --domicile-command-socket was not bound. Its answer is below"
  ;;
"reloaded 1 11 none,first none "* | "edited 1 11 none,first none "*)
  FAILURE="the extension loaded in the default profile and not in work: \
MirrorUserExtensions did not install it there, or it is switched off there"
  ;;
"reloaded 1 11 none,first,second none,first "*)
  FAILURE="THE OTHER PROFILE KEPT THE OLD EDIT: load_unpacked reloaded the \
extension in the default profile and not in work \
(BrowserProfileRegistry::ReloadUnpackedElsewhere)"
  ;;
"reloaded 1 11 none,first,second,third none,first,second "*)
  FAILURE="THE OTHER PROFILE KEPT THE OLD DIRECTORY: the extension moved, and \
work did not reload from the directory load_unpacked named \
(BrowserProfileRegistry::ReloadUnpackedElsewhere)"
  ;;
"reloaded 1 11 none,first,second,third none,first,second,third "*)
  FAILURE="every edit ran in both profiles, and the engine did not answer \
each load_unpacked with loaded_unpacked. Its answers are below"
  ;;
"reloaded 1 11 "*)
  FAILURE="the default profile's own page did not run each edit, so \
load_unpacked did not reload the extension where it loads it first"
  ;;
"edited 1 11 "*)
  FAILURE="an edit ran with no load_unpacked to load it, or the first one \
did not run in both profiles, so the claim's edits prove nothing"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED) -- \
the run did not get as far as reading"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-extension-reload: $FAILURE" "$ENGINE_LOG"
echo "the engine answered load_unpacked:" >&2
cat "$ANSWERS" >&2
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the pages' and the extension's lines, in order:" >&2
grep -E "GUARD |domicile: .*extension" "$ENGINE_LOG" | tail -40 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
