#!/usr/bin/env bash
# A profile's protections reach its pages: the default profile asks sites not
# to sell or share its data and blocks other sites' cookies, and a profile that
# turns them off does neither.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-browser-protections.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the pages' console lines from the engine's log and the header they were
# asked for with from the page server's, so it needs no pixels and no client.
#
# WHY THIS EXISTS. A profile's `protections` in the config become the
# profile's prefs in the engine (protection_settings.cc), and a pref is only
# a promise: Global Privacy Control reaches a page only when
# kUniversalOptOutSettings is on (the patch that names this guard), and a cookie setting only
# blocks when the cookie code reads it from that profile. The unit tests check
# the prefs; this checks what a site sees.
#
# The stand-in compositor sends profile `default`, with every protection on,
# and `work`, with every one off. The shell opens a window in each at
# 127.0.0.1, whose page embeds a frame from localhost, another site, that
# sets a cookie and reads it back. Asserted:
#
#   the shell page ran           or nothing was set up
#   default: GPC true            navigator.globalPrivacyControl
#   default: Sec-GPC: 1          on the page's request
#   default: cookie blocked      the frame could not keep it
#   work: GPC false, no header   the same page, the profile's setting off
#   work: cookie kept            the control: the frame can keep a cookie,
#                                so default's block is the setting's
#
# `work` is the control, in the same run: the same pages in a profile with
# every protection off must see none of them.
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
  annotate "guard-browser-protections: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-browser-protections-broker}"
CONTROL="${CONTROL:-/tmp/domicile-browser-protections-control}"
PROFILE="${PROFILE:-/tmp/domicile-browser-protections-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-browser-protections-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-browser-protections-socket.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-browser-protections-http.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"
# Without a size the headless window's viewport is empty, so the <webview>s
# are out of it.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-browser-protections: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-browser-protections: no python3, which serves the pages and the compositor's end of the socket"
  exit 77
}

fresh_broker
rm -f "$CONTROL"
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The pages, on their own server like every <webview> guard's: `crux`
#    reaches no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-browser-protections-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-browser-protections: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-browser-protections: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}

# 2. The compositor's end, with the profiles.
OFF='{"block_third_party_cookies": false, "global_privacy_control": false, "hide_local_ip_address": false}'
PROFILES="{\"profiles\": [\
{\"id\": \"default\", \"name\": \"Default\", \"color\": \"#0d9488\", \
\"private\": false, \"extensions\": null}, \
{\"id\": \"work\", \"name\": \"Work\", \"color\": \"#d97706\", \
\"private\": false, \"extensions\": null, \"protections\": $OFF}, \
{\"id\": \"private\", \"name\": \"Private\", \"color\": \"#a78bfa\", \
\"private\": true, \"extensions\": null}], \
\"default_profile\": \"default\", \"default_private_profile\": \"private\", \
\"sites\": {}}"
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --browser-profiles "$PROFILES" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-browser-protections: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

# 3. The engine. The address goes last: it is a URL, whose own `:` and `/`
#    are encoded out of the shell's query.
PAGE="http%3A%2F%2F127.0.0.1%3A$PORT%2Fpage"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size="$WIDTH,$HEIGHT" \
  --app="domicile://shell/?profiles=default,work&page=$PAGE" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-browser-protections.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 4. Wait for both frames to say what they kept.
TRIES=$((FOR_SECONDS * 4))
for _ in $(seq 1 "$TRIES"); do
  [ "$(grep -c "GUARD cookie as=" "$ENGINE_LOG" 2>/dev/null)" -ge 2 ] && break
  sleep 0.25
done

# Whether the shell ran; then for default and for work: the page's GPC
# (`none` for no report), how many requests for its page carried `Sec-GPC: 1`,
# and whether its frame kept the cookie (`none` for no report).
READ="$(awk '
  /GUARD shell-loaded/ { shell = 1 }
  match($0, /GUARD gpc as=[a-z0-9-]+ value=[a-z]+/) {
    split(substr($0, RSTART + 10, RLENGTH - 10), f, /[ =]/)
    gpc[f[2]] = f[4]
  }
  match($0, /^GUARD sec-gpc as=[a-z0-9-]+ value=1$/) {
    split(substr($0, 15), f, /[ =]/)
    header[f[2]]++
  }
  match($0, /GUARD cookie as=[a-z0-9-]+ third-party=[a-z]+/) {
    split(substr($0, RSTART + 13, RLENGTH - 13), f, /[ =]/)
    cookie[f[2]] = f[4]
  }
  END {
    printf "%d %s %d %s %s %d %s\n", shell,
      ("default" in gpc ? gpc["default"] : "none"), header["default"],
      ("default" in cookie ? cookie["default"] : "none"),
      ("work" in gpc ? gpc["work"] : "none"), header["work"],
      ("work" in cookie ? cookie["work"] : "none")
  }' "$ENGINE_LOG" "$HTTP_LOG" 2>/dev/null)"

MEASURED="$READ"
echo
echo "measured: $MEASURED"
echo "  (shell default-gpc default-sec-gpc default-cookie work-gpc work-sec-gpc work-cookie)"

# A window asked for before the engine knew its profile opens in the default
# one (ContextFor), so work would measure default's protections. The shell
# waits for the profiles; this says so if it ever stops.
FELL_BACK=0
grep -qF "which the desk does not have" "$ENGINE_LOG" 2>/dev/null && FELL_BACK=1

# Which end to blame. `packages/domicile-engine/tests/test-browser-protections-guard.sh`
# runs the reading and this block directly.
FAILURE=""
PASSED=""
if [ "${FELL_BACK:-0}" = 1 ]; then
  FAILURE="a window opened before the engine knew its profile, so it opened \
in the default profile and measured that one's protections: the shell did not \
wait for browserprofileschanged"
fi
[ -n "$FAILURE" ] || case "$MEASURED" in
"1 true 1 blocked false 0 kept")
  PASSED="a profile's protections reached its pages: the default profile \
asked sites not to sell or share its data, on the page and on the wire, and \
blocked another site's cookie; work, with them off, did neither"
  ;;
"0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
"1 none "* | *" none")
  FAILURE="a page or its frame never reported: openBrowserWindow opened no \
window in a profile, or the list never reached the shell (no \
\`GUARD profiles-known\`), or the frame from localhost never loaded"
  ;;
"1 false "*)
  FAILURE="THE DEFAULT PROFILE'S PAGE DID NOT ASK FOR PRIVACY: \
navigator.globalPrivacyControl was false with global_privacy_control on. The \
pref is set (ApplyProtections), so it did not reach the renderer: \
kUniversalOptOutSettings is off, or the renderer prefs were read before \
the pref was set"
  ;;
"1 true 0 "*)
  FAILURE="the default profile's page asked for privacy but its request \
carried no Sec-GPC header: the network side does not read the profile's \
pref (universal_optout in the URL loader's headers)"
  ;;
"1 true 1 kept "*)
  FAILURE="THE DEFAULT PROFILE KEPT ANOTHER SITE'S COOKIE: with \
block_third_party_cookies on, the frame from localhost kept its cookie, so \
kCookieControlsMode did not reach that profile's cookie settings, or it was \
set on another profile (ProtectOne)"
  ;;
"1 true 1 blocked true "* | "1 true 1 blocked false "[1-9]*)
  FAILURE="work, with global_privacy_control off, still asked for privacy: \
GPC is on for a reason that is not the profile's setting: its pages took \
another profile's renderer preferences (PrefsTabHelper in AttachTabHelpers), \
a feature forces it, or the pref was applied to every profile. The claim \
then proves only that it is on"
  ;;
"1 true 1 blocked false 0 blocked")
  FAILURE="work, with block_third_party_cookies off, blocked the frame's \
cookie too, so something other than the setting blocks it (Chromium's own \
default, or the cookie never set over http://localhost), and the claim \
proves nothing"
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

annotate_from "guard-browser-protections: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the page server said:" >&2
tail -20 "$HTTP_LOG" >&2
echo "the shell's and the pages' steps, in order:" >&2
grep -E "GUARD " "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
