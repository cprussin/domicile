#!/usr/bin/env bash
# An installed extension takes a suggested key it was kept from, at its next
# load.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-extension-kept-key.sh /build/chromium/src
#
# WHY THIS EXISTS. Chrome assigns an extension's suggested keys at install
# only. Bitwarden installed while Ctrl+Shift+L was Chrome's own never got it,
# though patch 0282 frees it. Patch 0288 assigns free suggested keys at every
# load.
#
# Headless, with guard-extension-commands.sh's fixture and shell module. The
# engine installs the fixture and stops. guard-extension-kept-key-prefs.py
# takes its Ctrl+Shift+L out of the profile as Chrome leaves a kept key. The
# engine starts again on that profile.
#
# WHAT IT ASSERTS. That the first start bound Ctrl+Shift+L; that the profile
# lost it; and that the second start lists the fixture with it again.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the key is left as one the
# person cleared. The second start must list the fixture with no key for it,
# and its action's key still.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-extension-kept-key: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# guard-extension-commands.sh's fixture, id and keys.
readonly ID="cobncddhpfhclknjbapgflpohofecjhg"
readonly FILL="Ctrl+Shift+L"
readonly ACTION="Ctrl+Shift+U"

EXTENSION="$SCRIPTS/guard-extension-commands-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-extension-kept-key-broker}"
CONTROL="${CONTROL:-/tmp/domicile-extension-kept-key-control}"
PROFILE="${PROFILE:-/tmp/domicile-extension-kept-key-profile}"
LOGS="${LOGS:-/tmp/domicile-extension-kept-key}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    wait "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-extension-kept-key: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-extension-kept-key: no python3, and the compositor's end of the socket is served by one"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

TRIES=$((FOR_SECONDS * 4))
rm -rf "$PROFILE" "$LOGS"
mkdir -p "$PROFILE" "$LOGS"

# Starts the compositor stand-in and the engine on $PROFILE, and waits for the
# fixture's first row of keys. $1 names the start's logs.
start() {
  local socket_log="$LOGS/$1-socket.log" engine_log="$LOGS/$1-engine.log"
  fresh_broker
  rm -f "$CONTROL" "$socket_log" "$engine_log"
  python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
    --socket "$CONTROL" --unpacked "$EXTENSION" >"$socket_log" 2>&1 &
  STAND_IN=$!
  STARTED+=("$STAND_IN")
  wait_for_line 240 "listening on" "$socket_log" || {
    annotate_from "guard-extension-kept-key: the compositor stand-in never listened on $CONTROL ($1 start)" "$socket_log"
    exit 1
  }
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --ozone-override-screen-size=1024,768 \
    --window-size=1024,768 \
    --disable-gpu \
    --app="domicile://shell/?expect=$ID&control=0" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-extension-commands.js" \
    --domicile-control-socket="$CONTROL" \
    --no-sandbox --password-store=basic --no-first-run --disable-component-update \
    --user-data-dir="$PROFILE" \
    --enable-logging=stderr --log-level=0 \
    --domicile-broker-socket="$BROKER" >"$engine_log" 2>&1 &
  ENGINE=$!
  STARTED+=("$ENGINE")
  wait_for_line "$TRIES" '"GUARD row ' "$engine_log" ||
    echo "the $1 start listed no row for the fixture; the verdict below says what that means" >&2
}

# Stops the engine as a person quitting it does, so it writes its preferences.
stop() {
  kill -TERM "$ENGINE" 2>/dev/null
  wait "$ENGINE" 2>/dev/null
  kill "$STAND_IN" 2>/dev/null
  wait "$STAND_IN" 2>/dev/null
}

saw() { # $1 fixed string, $2 file
  grep -qF -- "$1" "$2" 2>/dev/null && echo 1 || echo 0
}

# 1. The install.
start first
FIRST=$(saw "\"GUARD row fill=$FILL action=$ACTION\"" "$LOGS/first-engine.log")
stop

# 2. The key taken out, as Chrome leaves one it kept, or one the person cleared.
if [ "$NEGATIVE" = "1" ]; then
  LEG=control
  CLEARED=(--cleared)
  SECOND_ROW="\"GUARD row fill= action=$ACTION\""
else
  LEG=claim
  CLEARED=()
  SECOND_ROW="\"GUARD row fill=$FILL action=$ACTION\""
fi
TOOK=$(python3 "$SCRIPTS/guard-extension-kept-key-prefs.py" \
  --profile "$PROFILE" --id "$ID" --command fill ${CLEARED[@]+"${CLEARED[@]}"})

# 3. The next load.
start second
SECOND=$(saw "$SECOND_ROW" "$LOGS/second-engine.log")

MEASURED="$LEG $FIRST $TOOK $SECOND"

echo
echo "measured: $MEASURED"
echo "what the shell said the second time:"
grep -F '"GUARD row ' "$LOGS/second-engine.log" | tail -4 || true

# WHICH END TO BLAME. `packages/domicile-engine/tests/test-extension-kept-key-guard.sh`
# runs this block directly. MEASURED is "<claim|control> <first> <took> <second>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"claim 1 took 1")
  PASSED="an extension whose suggested key was kept from it at install took it \
at its next load"
  ;;
"control 1 took 1")
  PASSED="the control is sharp: a key the person cleared stayed clear at the \
next load, and the action's key stayed"
  ;;
*" 0 "*)
  FAILURE="the first start never listed the fixture with the keys its manifest \
suggests, so there was no key to take out: guard-extension-commands.sh blames \
the end"
  ;;
*" 1 unwritten "*)
  FAILURE="the stopped engine left no preferences in its profile, so SIGTERM \
did not end it cleanly"
  ;;
*" 1 none "*)
  FAILURE="the stopped engine's preferences held no binding for the fixture's \
command: the engine did not write its keys before it stopped"
  ;;
"claim 1 took 0")
  FAILURE="the fixture did not take back its suggested key at its next load: \
CommandService::OnExtensionLoaded (patch 0288)"
  ;;
"control 1 took 0")
  FAILURE="a key the person cleared came back at the next load, or the \
action's key went: CanAutoAssign, or OnExtensionLoaded assigns over it"
  ;;
*)
  FAILURE="there is no measurement here of any kind ($MEASURED) -- the run did \
not get as far as reading"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-extension-kept-key: $FAILURE" "$LOGS/second-engine.log"
echo "the engine's last words, the first time ($LOGS/first-engine.log):" >&2
last_words "$LOGS/first-engine.log" >&2
echo "the engine's last words, the second time ($LOGS/second-engine.log):" >&2
last_words "$LOGS/second-engine.log" >&2
exit 1
