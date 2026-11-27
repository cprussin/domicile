#!/usr/bin/env bash
# The engine loads none of Chrome's AI component extensions: Gemini in Chrome
# and Contextual Tasks.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-no-chrome-component-extensions.sh /build/chromium/src
#
# Headless and software-composited. It reads the profile, so it needs no
# pixels and no client.
#
# Why: the field trial testing config turns on `Glic` and
# `ApiContextualTasksPrivate`, so Chromium's ComponentLoader loaded both
# extensions into every profile. Each one's service worker runs in a renderer
# of its own, about 30 MiB, at startup and again whenever a page opens. A desk
# has neither feature's UI. An Electron app's window woke them in both the
# desk's profiles, so the app cost more on the engine than on its own Electron
# (the `electron-app-on-a-tty` VM check). Patch 0296 leaves both out.
#
# The shell loads and does nothing. The engine is then asked to exit, and on
# exit it writes the profile's Preferences, where `extensions.settings` holds
# every extension the profile loaded. Asserted:
#
#   the shell page ran    or nothing was set up
#   Preferences read      the engine exited by itself and its Preferences have
#                         `extensions.settings`
#   the PDF viewer        a component extension a desk keeps is there, so
#                         component extensions do reach the Preferences
#   none loaded           neither extension is there
#
# Control: NEGATIVE=1 loads an unpacked extension from the command line. Its
# entry, found by its directory, must be in the Preferences, so the guard
# reads the extensions the engine loaded and not some other list.
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
  annotate "guard-no-chrome-component-extensions: no path to chromium/src was given"
  exit 1
fi

# The ids ComponentLoader gives Chrome's own extensions, from their manifests'
# keys.
GEMINI="admccjkmockfdflocgggjfgdacdodkdf"
CONTEXTUAL_TASKS="glbjnfimcajjenihimblfaponejbkoph"
# The PDF viewer's, a component extension a desk keeps.
PDF_VIEWER="mhjfbmdgcfjbbpaeojofohoefgiehjai"

# NEGATIVE=1 loads an extension of its own. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="claim"
WHICH=""
if [ "$NEGATIVE" = "1" ]; then
  MODE="control"
  WHICH="-negative"
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-no-chrome-component-extensions$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-no-chrome-component-extensions$WHICH-profile}"
EXTENSION="${EXTENSION:-/tmp/domicile-no-chrome-component-extensions$WHICH-extension}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-no-chrome-component-extensions$WHICH-engine.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"
# Longer than `EndSession()`'s ten-second wait for its writes.
TO_EXIT_SECONDS="${TO_EXIT_SECONDS:-20}"

BROWSER=""
cleanup() {
  [ -n "$BROWSER" ] && kill -KILL "$BROWSER" 2>/dev/null
  remove_profile "$PROFILE"
  rm -rf "$EXTENSION"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-no-chrome-component-extensions: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}

saw() { # $1 pattern
  grep -qF -- "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

# The control's extension: a service worker and nothing else, as the two
# component extensions are.
rm -rf "$EXTENSION"
mkdir -p "$EXTENSION"
cat >"$EXTENSION/manifest.json" <<'EOF'
{"manifest_version": 3, "name": "guard extension", "version": "1",
 "background": {"service_worker": "worker.js"}}
EOF
echo 'console.log("GUARD extension worker ran");' >"$EXTENSION/worker.js"
LOAD=()
if [ "$MODE" = "control" ]; then
  # Chromium turns the switch off by default, and turns it back on with this
  # feature off.
  LOAD=(--load-extension="$EXTENSION" --disable-features=DisableLoadExtensionCommandLineSwitch)
fi

fresh_broker
rm -rf "$PROFILE"
mkdir -p "$PROFILE"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size=1024,768 \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-no-chrome-component-extensions.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  "${LOAD[@]}" \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
BROWSER=$!
for _ in $(seq 1 $((FOR_SECONDS * 4))); do
  grep -qF "GUARD shell-loaded" "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done
# The extensions load with the profile, before the shell's page. The engine
# writes the profile's Preferences as it exits. A hung engine is killed, and
# then nothing here is read.
kill -TERM "$BROWSER" 2>/dev/null
( sleep "$TO_EXIT_SECONDS"; kill -KILL "$BROWSER" 2>/dev/null ) &
WATCHDOG=$!
EXITED=0
wait "$BROWSER" && EXITED=1
kill "$WATCHDOG" 2>/dev/null
BROWSER=""

# Reads the Preferences' extensions: "<read> <pdf-viewer> <gemini>
# <contextual-tasks> <own>", and the ids on the next line. A file that is
# missing, isn't JSON or has no `extensions.settings` reads 0, and says why on
# stderr. `tests/test-no-chrome-component-extensions-guard.sh` runs this.
read_preferences() { # $1 Preferences, $2 the control's extension directory
  python3 -I - "$1" "$2" "$PDF_VIEWER" "$GEMINI" "$CONTEXTUAL_TASKS" <<'EOF'
import json, os, sys
preferences, own, *ids = sys.argv[1:]
try:
    settings = json.load(open(preferences))["extensions"]["settings"]
    if not isinstance(settings, dict):
        raise TypeError(f"extensions.settings is a {type(settings).__name__}")
except (OSError, ValueError, KeyError, TypeError) as error:
    print(f"the Preferences at {preferences} could not be read: {error!r}", file=sys.stderr)
    print("0 0 0 0 0")
    sys.exit()
mine = any(
    isinstance(entry, dict)
    and os.path.realpath(entry.get("path", "")) == os.path.realpath(own)
    for entry in settings.values()
)
print(1, *(int(id in settings) for id in ids), int(mine))
print(" ".join(settings))
EOF
}
READ="$(read_preferences "$PROFILE/Default/Preferences" "$EXTENSION")"
LOADED="$(printf '%s\n' "$READ" | sed -n 2p)"
# Read only if the engine exited by itself, so it wrote them whole.
[ "$EXITED" = 1 ] || READ="0 0 0 0 0"

MEASURED="$MODE $(saw "GUARD shell-loaded") $(printf '%s\n' "$READ" | sed -n 1p)"
echo
echo "measured: $MEASURED"
echo "  (mode shell-ran preferences-read pdf-viewer gemini contextual-tasks own-extension)"

# Which end to blame. `packages/domicile-engine/tests/test-no-chrome-component-extensions-guard.sh`
# runs this block directly. MEASURED is "<mode> <shell-ran>
# <preferences-read> <pdf-viewer> <gemini> <contextual-tasks> <own-extension>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"claim 0 "* | "control 0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
"claim 1 0 "* | "control 1 0 "*)
  FAILURE="the engine did not exit by itself and write the profile's \
Preferences, or they have no extensions.settings, so nothing here says which \
extensions it loaded"
  ;;
"claim 1 1 0 "*)
  FAILURE="the profile's Preferences do not have the PDF viewer, a component \
extension a desk keeps, so their having neither of Chrome's AI extensions \
says nothing"
  ;;
"claim 1 1 1 0 0 "*)
  PASSED="a profile loads neither Gemini in Chrome nor Contextual Tasks"
  ;;
"claim 1 1 1 "*)
  FAILURE="THE PROFILE LOADED CHROME'S AI COMPONENT EXTENSIONS ($MEASURED): \
each one's service worker starts a renderer of its own, in every profile, \
whenever a page opens. ComponentLoader::AddGlicExtension and \
AddContextualTasksExtension add nothing in Domicile's engine (patch 0296)"
  ;;
"control 1 1 "*" 1")
  PASSED="the control is sharp: the extension it loaded is in the profile's \
Preferences, and this guard sees it"
  ;;
"control 1 1 "*)
  FAILURE="the control loaded an extension and the profile's Preferences do \
not have it, so the claim's none says nothing"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED)"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-no-chrome-component-extensions: $FAILURE" "$ENGINE_LOG"
echo "the extensions the profile loaded: ${LOADED:-none read}" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
