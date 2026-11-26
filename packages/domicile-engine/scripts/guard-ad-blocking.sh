#!/usr/bin/env bash
# A profile's ad blocking reaches its pages: the config's filter lists and the
# user's own rules block a website's requests in the mode of the profile its
# page is in, and a profile with blocking off loads everything.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-ad-blocking.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the pages' console lines from the engine's log and the scripts served from
# the page server's, so it needs no pixels and no client.
#
# WHY THIS EXISTS. The unit tests check what the blocker says of a request
# (ad_blocker_unittest.cc); this checks that a page's requests are asked at
# all: that the lists are read and built before the page loads, that
# ProxyAdBlocking is in front of the frame's loads (the patch that names this
# guard), and that each profile's mode is the one used.
#
# The list, a file this guard writes, names `/ads/*` and makes an exception for
# `/ads/allowed.js`. The user's rules name `/mine/*`. The stand-in compositor
# sends profile `default`, on standard, `strict`, and `off`. The shell opens a
# window in each at 127.0.0.1, whose page loads five scripts (see
# guard-ad-blocking-server.py). Asserted, as third first mine allowed ok:
#
#   the shell page ran                 or nothing was set up
#   default: B L B L L                 another site's listed script blocked,
#                                      the page's own not; the user's rule
#                                      blocks either; the exception and an
#                                      unlisted script load
#   strict:  B B B L L                 the page's own listed script blocked too
#   off:     L L L L L                 the control: every script can load, so
#                                      the others' blocks are the blocker's
#   no blocked script was served       a block is the blocker's, before the
#                                      network, not a failed load
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
  annotate "guard-ad-blocking: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-ad-blocking-broker}"
CONTROL="${CONTROL:-/tmp/domicile-ad-blocking-control}"
PROFILE="${PROFILE:-/tmp/domicile-ad-blocking-profile}"
LIST="${LIST:-/tmp/domicile-ad-blocking-list.txt}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-ad-blocking-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-ad-blocking-socket.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-ad-blocking-http.log}"
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
  rm -f "$LIST"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-ad-blocking: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-ad-blocking: no python3, which serves the pages and the compositor's end of the socket"
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

# 1. The list, as a path: a guard fetches nothing from the internet.
printf '! a list for guard-ad-blocking.sh\n/ads/*\n@@/ads/allowed.js\n' >"$LIST"

# 2. The pages, on their own server like every <webview> guard's: `crux`
#    reaches no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-ad-blocking-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-ad-blocking: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-ad-blocking: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}

# 3. The compositor's end, with the profiles, the list and the rule.
PROFILES="{\"profiles\": [\
{\"id\": \"default\", \"name\": \"Default\", \"color\": \"#0d9488\", \
\"private\": false, \"extensions\": null}, \
{\"id\": \"strict\", \"name\": \"Strict\", \"color\": \"#2563eb\", \
\"private\": false, \"extensions\": null, \
\"protections\": {\"block_ads_and_trackers\": \"strict\"}}, \
{\"id\": \"off\", \"name\": \"Off\", \"color\": \"#d97706\", \
\"private\": false, \"extensions\": null, \
\"protections\": {\"block_ads_and_trackers\": \"off\"}}, \
{\"id\": \"private\", \"name\": \"Private\", \"color\": \"#a78bfa\", \
\"private\": true, \"extensions\": null}], \
\"default_profile\": \"default\", \"default_private_profile\": \"private\", \
\"sites\": {}, \"block_lists\": [\"$LIST\"], \"block_rules\": [\"/mine/*\"]}"
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --browser-profiles "$PROFILES" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-ad-blocking: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

# 4. The engine, with the protections guard's shell, which opens a window per
#    profile. The address goes last: it is a URL, whose own `:` and `/` are
#    encoded out of the shell's query. `domicile_ad_blocking` at 1 says what
#    it blocked, for the failure's log.
PAGE="http%3A%2F%2F127.0.0.1%3A$PORT%2Fpage"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size="$WIDTH,$HEIGHT" \
  --app="domicile://shell/?profiles=default,strict,off&page=$PAGE" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-browser-protections.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 --vmodule="domicile_ad_blocking=1" \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 5. Wait for the three pages to say which scripts ran.
TRIES=$((FOR_SECONDS * 4))
for _ in $(seq 1 "$TRIES"); do
  [ "$(grep -c "GUARD ads as=" "$ENGINE_LOG" 2>/dev/null)" -ge 3 ] && break
  sleep 0.25
done

# Whether the shell ran; for default, strict and off, which of third, first,
# mine, allowed and ok ran, a letter each (B blocked, L loaded, ? no report);
# and how many scripts a page said were blocked that the server served.
READ="$(awk '
  /GUARD shell-loaded/ { shell = 1 }
  match($0, /GUARD ads as=[a-z0-9-]+( [a-z]+=[a-z]+)+/) {
    n = split(substr($0, RSTART + 10, RLENGTH - 10), f, / /)
    split(f[1], a, /=/)
    for (i = 2; i <= n; i++) {
      split(f[i], kv, /=/)
      ran[a[2] SUBSEP kv[1]] = kv[2]
    }
  }
  match($0, /^GUARD served as=[a-z0-9-]+ what=[a-z]+$/) {
    split(substr($0, 14), f, /[ =]/)
    served[f[2] SUBSEP f[4]]++
  }
  function letters(as,   out, i, w, how) {
    split("third first mine allowed ok", w, / /)
    out = ""
    for (i = 1; i <= 5; i++) {
      how = ran[as SUBSEP w[i]]
      out = out (how == "blocked" ? "B" : how == "loaded" ? "L" : "?")
    }
    return out
  }
  END {
    leaked = 0
    for (k in served) if (ran[k] == "blocked") leaked += served[k]
    printf "%d %s %s %s %d\n", shell, letters("default"), letters("strict"),
      letters("off"), leaked
  }' "$ENGINE_LOG" "$HTTP_LOG" 2>/dev/null)"

MEASURED="$READ"
echo
echo "measured: $MEASURED"
echo "  (shell default strict off leaked; each profile as third first mine allowed ok)"

# Which end to blame. `packages/domicile-engine/tests/test-ad-blocking-guard.sh`
# runs the reading and this block directly.
FAILURE=""
PASSED=""
case "$MEASURED" in
"1 BLBLL BBBLL LLLLL 0")
  PASSED="a profile's ad blocking reached its pages: default blocked another \
site's listed script and not the page's own, strict blocked both, the user's \
rule blocked in either and the list's exception loaded; off loaded everything, \
and no blocked script reached the server"
  ;;
"0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
*"?"*)
  FAILURE="a page never said which scripts ran: openBrowserWindow opened no \
window in a profile, the list never reached the shell, or a page's scripts \
never settled"
  ;;
*" "[1-9]*)
  FAILURE="a script a page called blocked was served all the same, so it \
failed after the network, not in front of it: the blocker did not block it \
and something else (the server, a MIME check) made it fail"
  ;;
"1 "?????" "?????" "*B*)
  FAILURE="off, with blocking off, could not load a script either, so \
something other than the blocker blocks it (the profile's mode is not read, \
ProxyAdBlocking ignores Off, or the server fails it) and the other profiles' \
blocks prove nothing"
  ;;
"1 L"*)
  FAILURE="THE DEFAULT PROFILE LOADED ANOTHER SITE'S LISTED SCRIPT: the list \
never reached the blocker (Configure, the read of a path) or the blocker is \
not in front of the page's loads (ProxyAdBlocking in \
WillCreateURLLoaderFactory)"
  ;;
"1 "?B*)
  FAILURE="the default profile, on standard, blocked the page's own listed \
script: standard blocks only other sites' (third_party in ShouldBlock), or \
the page it was asked for is not the frame's"
  ;;
"1 "??L*)
  FAILURE="the default profile loaded the script the user's rule names: \
block_rules never reached the blocker, or its engine is not asked"
  ;;
"1 "???B* | "1 "?????" "???B*)
  FAILURE="the list's exception was blocked: the lists' engine did not \
report it (check_network_request_subset's exceptions), or a block ignores it"
  ;;
"1 "????B* | "1 "?????" "????B*)
  FAILURE="a script nothing names was blocked: the blocker blocks more than \
its lists say"
  ;;
"1 "?????" "L* | "1 "?????" "??L*)
  FAILURE="strict loaded what default blocked: the strict profile's mode is \
not the one used (another profile's, or Off)"
  ;;
"1 "?????" "?L*)
  FAILURE="STRICT LOADED THE PAGE'S OWN LISTED SCRIPT: the strict mode never \
reached the engine (AdBlockingModeOf) or block_first_party is not passed"
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

annotate_from "guard-ad-blocking: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the page server said:" >&2
tail -20 "$HTTP_LOG" >&2
echo "the shell's and the pages' steps, and the blocker's, in order:" >&2
grep -E "GUARD |domicile: ad blocking|domicile: block list" "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
