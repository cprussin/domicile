#!/usr/bin/env bash
# An extension the compositor names, installed by the engine and running.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-extension-installer.sh /build/chromium/src
#
# WHY THIS EXISTS. A desk's `[extensions]` reaches the browser as one
# `extensions` message on the control socket, which the control channel stops
# and hands to `domicile::InstallExtensionsInto` -- see
# src/chrome/browser/domicile/domicile_extension_installer.h. What the desk
# asked for is that the extension RUNS, so that is what this reads: the
# content-script fixture's mark, in a <webview>, in an engine started without
# `--load-extension`.
#
# Headless, with a stand-in for the compositor's end of the control socket, as
# `guard-control-arrival.sh`; the page, the fixture and the colors are
# `guard-webview-content-script.sh`'s.
#
# WHAT IT ASSERTS. That the stand-in sent the list naming the fixture as
# `unpacked`, and that `COLOR` is then somewhere in the window, with the
# shell's background as the witness. The shell reloads the <webview> every
# second, because only a page loaded after the install is injected.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control: the same run with `unpacked`
# empty. It MUST NOT show `COLOR`, and its witness is the served page's own
# color, so the absence is read off a guest that drew -- after a list that
# was sent, so the absence is an answer to it.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-extension-installer: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The mark. Fixed rather than overridable: the fixture's `content.js` paints
# it, and `scripts/test-extension-installer-guard.sh` holds the two together.
readonly COLOR="8E24AA"
# The shell's background, and the served page's own color: not the
# content-script guard's, so the two can share a machine without reading each
# other.
WITNESS="${WITNESS:-1C3A2E}"
PAGE_COLOR="${PAGE_COLOR:-25A8F9}"

EXTENSION="$SCRIPTS/guard-webview-content-script-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-extension-installer-broker}"
CONTROL="${CONTROL:-/tmp/domicile-extension-installer-control}"
PROFILE="${PROFILE:-/tmp/domicile-extension-installer-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-extension-installer-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-extension-installer-socket.log}"
PROBE_LOG="${PROBE_LOG:-/tmp/domicile-extension-installer-probe.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-extension-installer-http.log}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-extension-installer: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-extension-installer: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-extension-installer: no python3, and the page and the compositor's end of the socket are served by one"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

rm -f "$BROKER" "$CONTROL"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# 1. The page. Its own server: `crux` reaches no arbitrary host.
python3 "$SCRIPTS/guard-webview-content-script-server.py" \
  --port 0 --color "$PAGE_COLOR" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 60 "serving" "$HTTP_LOG" || {
  annotate_from "guard-extension-installer: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-extension-installer: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
PAGE="http://127.0.0.1:$PORT/page"

# 2. The compositor's end, naming the fixture -- or, for the control, nothing.
if [ "$NEGATIVE" = "1" ]; then
  NAMED=()
  WITNESSED="$PAGE_COLOR"
  FOR_SECONDS="$(budget_for extension-installer "$FOR_SECONDS")"
else
  NAMED=(--unpacked "$EXTENSION")
  WITNESSED="$WITNESS"
fi
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" ${NAMED[@]+"${NAMED[@]}"} >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-extension-installer: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 3. The engine. No `--load-extension` and no `--disable-features`: the only
#    way the fixture gets in is the list.
STARTED_AT="$(date +%s)"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?witness=$WITNESS&src=$PAGE" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-extension-installer.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do
  [ -S "$BROKER" ] && break
  sleep 0.5
done
[ -S "$BROKER" ] || {
  annotate_from "guard-extension-installer: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}
echo "the engine is listening on $BROKER, showing $PAGE in a <webview>"

# 4. The reading.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$CHROMIUM/$OUT/domicile_color_probe" \
    --domicile-broker-socket="$BROKER" \
    --color="FF$COLOR" \
    --witness="FF$WITNESSED" \
    --for-seconds="$FOR_SECONDS" 2>&1 | tee "$PROBE_LOG"
STATUS="${PIPESTATUS[0]}"
echo "the probe exited $STATUS"

SENT=0
grep -qF "sent the extensions" "$SOCKET_LOG" 2>/dev/null && SENT=1

if [ "$NEGATIVE" = "1" ]; then
  MEASURED="control $STATUS $SENT"
else
  # Only on a pass: a failed run measured this script's patience.
  if [ "$STATUS" -eq 0 ]; then
    budget_note extension-installer "$(($(date +%s) - STARTED_AT))"
  fi
  MEASURED="installed $STATUS $SENT"
fi

echo
echo "measured: $MEASURED"

# WHICH END TO BLAME. `scripts/test-extension-installer-guard.sh` runs this
# block directly. The last field is whether the stand-in sent the list.
FAILURE=""
PASSED=""
case "$MEASURED" in
"installed 0 1")
  PASSED="an extension named only by the compositor's list was installed, and \
its content script marked a page in a <webview>"
  ;;
"installed 0 0")
  FAILURE="the mark appeared but the list was never sent, so something other \
than the installer put the extension there. Check the engine's flags, and \
that the profile was fresh"
  ;;
"installed 1 0")
  FAILURE="the list was never sent: the browser did not connect to the \
compositor stand-in, so the shell's control channel did not bind. Nothing here \
reached the installer"
  ;;
"installed 1 1")
  FAILURE="the list was sent and the <webview> showed no mark. The shell drew, \
so the installer did not install the extension, or it is disabled, or the \
channel did not hand the message on. The engine log has the installer's \
'domicile:' lines and any load error"
  ;;
"installed 2 "*)
  FAILURE="nothing was measured: the shell's own background never appeared, \
so the browser drew no page at all. This is the harness, not the installer"
  ;;
"installed "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"control 1 1")
  PASSED="the control is sharp: an empty list, sent, left the same page in the \
same <webview> unmarked -- so the claim's mark is the list's"
  ;;
"control 0 "*)
  FAILURE="the page was marked with an empty list, so the installer added an \
extension it was not told to, or the profile was not fresh, and the claim \
proves nothing"
  ;;
"control 1 0")
  FAILURE="the page drew unmarked, but the list was never sent, so the absence \
answers nothing: the shell's control channel did not bind"
  ;;
"control 2 "*)
  FAILURE="nothing was measured: the page in the <webview> never drew, so its \
missing mark is not a reading. The guest, or the harness"
  ;;
"control "*)
  FAILURE="the probe did not run for the control ($MEASURED), so it measured \
nothing"
  ;;
*)
  FAILURE="there is no measurement here of any kind ($MEASURED) -- the probe \
did not run, or ran for something this guard does not know how to read"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-extension-installer: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the engine's last words ($ENGINE_LOG):" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
