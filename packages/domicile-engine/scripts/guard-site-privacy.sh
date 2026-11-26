#!/usr/bin/env bash
# A page's ad blocking can be turned off for its window or its site, as a
# shield in the address bar does, and the shell hears how many of its requests
# were blocked.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-site-privacy.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the pages' and the shell's console lines from the engine's log, so it needs
# no pixels and no client.
#
# WHY THIS EXISTS. `setBlockAdsAndTrackers` keeps a site's mode in its
# profile's prefs and a window's on its page (page_privacy.h), and the request
# check reads both (domicile_ad_blocking.cc). The unit tests check the prefs;
# this checks that what a shell sets is what a page's requests are checked in,
# for that window or that site only, and that what the shell is told matches.
#
# The list and the rule are guard-ad-blocking.sh's, so on standard a page's
# five scripts load as B L B L L (third first mine allowed ok), two blocked.
# The shell (guard-site-privacy.js) draws two <webview>s, a and b, on the same
# site, and asserted, as the page's scripts and then what the shell read:
#
#   1  a1: B L B L L  standard, for the profile, 2 blocked
#   2  a, off for its window: a2 L L L L L, off for the window, 0 blocked
#   3  b1: B L B L L  b is another window, still standard
#   4  off for the site, from a, a's own cleared:
#      a3 and b2: L L L L L, off for the site, 0 blocked
#   5  b clears the site's: b3 B L B L L, standard for the profile, 2 blocked
#
# Every step's page is its own control: the step before or after it blocks on
# the same site in the same run.
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
  annotate "guard-site-privacy: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-site-privacy-broker}"
CONTROL="${CONTROL:-/tmp/domicile-site-privacy-control}"
COMMAND="${COMMAND:-/tmp/domicile-site-privacy-command}"
ANSWERS="${ANSWERS:-/tmp/domicile-site-privacy-answers.log}"
PROFILE="${PROFILE:-/tmp/domicile-site-privacy-profile}"
LIST="${LIST:-/tmp/domicile-site-privacy-list.txt}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-site-privacy-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-site-privacy-socket.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-site-privacy-http.log}"
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
  rm -f "$LIST" "$COMMAND"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-site-privacy: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-site-privacy: no python3, which serves the pages and the compositor's end of the socket"
  exit 77
}

fresh_broker
rm -f "$CONTROL" "$COMMAND" "$ANSWERS"
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The list, as a path: a guard fetches nothing from the internet.
printf '! a list for guard-site-privacy.sh\n/ads/*\n@@/ads/allowed.js\n' >"$LIST"

# 2. The pages, on their own server like every <webview> guard's: `crux`
#    reaches no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-ad-blocking-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-site-privacy: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-site-privacy: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}

# 3. The compositor's end, with the default profile on standard, the list
#    and the rule.
PROFILES="{\"profiles\": [\
{\"id\": \"default\", \"name\": \"Default\", \"color\": \"#0d9488\", \
\"private\": false, \"extensions\": null}, \
{\"id\": \"private\", \"name\": \"Private\", \"color\": \"#a78bfa\", \
\"private\": true, \"extensions\": null}], \
\"default_profile\": \"default\", \"default_private_profile\": \"private\", \
\"sites\": {}, \"block_lists\": [\"$LIST\"], \"block_rules\": [\"/mine/*\"]}"
rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --browser-profiles "$PROFILES" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-site-privacy: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

# 4. The engine, with this guard's shell. The address goes last: it is a URL,
#    whose own `:` and `/` are encoded out of the shell's query.
#    `domicile_ad_blocking` and `web_view_guest` at 1 say what was blocked and
#    set, for the failure's log.
PAGE="http%3A%2F%2F127.0.0.1%3A$PORT%2Fpage"
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size="$WIDTH,$HEIGHT" \
  --app="domicile://shell/?page=$PAGE" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-site-privacy.js" \
  --domicile-control-socket="$CONTROL" \
  --domicile-command-socket="$COMMAND" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 --vmodule="domicile_ad_blocking=1,web_view_guest=1" \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 5. Wait for the shell to finish its steps, or say it could not.
TRIES=$((FOR_SECONDS * 4))
for _ in $(seq 1 "$TRIES"); do
  grep -qE "GUARD privacy (done|failed)" "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

# 6. As the Settings app does: set the site to strict in the default profile
#    from the command socket, list it, then clear it and list again, waiting
#    each time for b's page to be told without a load. Each answer goes to
#    $ANSWERS as `SETTINGS <what>=<answer>`.
settings() { # $1 what, $2 the request's JSON
  python3 - "$COMMAND" "$1" "$2" <<'PY' >>"$ANSWERS" 2>&1
import json, socket, sys

what, line = sys.argv[2], sys.argv[3]
try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(30)
    connection.connect(sys.argv[1])
    connection.sendall((line + "\n").encode())
    answer = json.loads(connection.makefile().readline())
except (OSError, ValueError) as failure:
    print("SETTINGS %s=no-answer" % what)
    print("  (%s)" % failure)
    sys.exit(0)
if answer.get("type") == "site_privacy":
    sites = ["%s:%s:%s" % (each["profile"], each["site"],
                           each["block_ads_and_trackers"])
             for each in answer["sites"]]
    print("SETTINGS %s=%s" % (what, ",".join(sites) or "none"))
else:
    print("SETTINGS %s=%s" % (what, answer.get("type")))
    print("  (%s)" % json.dumps(answer))
PY
}
if grep -q "GUARD privacy done" "$ENGINE_LOG" 2>/dev/null; then
  settings set1 '{"type":"set_site_privacy","version":1,"profile":"default","site":"127.0.0.1","block_ads_and_trackers":"strict"}'
  settings list1 '{"type":"site_privacy","version":1}'
  wait_for_line 40 "GUARD privacy later view=b mode=strict" "$ENGINE_LOG"
  settings set2 '{"type":"set_site_privacy","version":1,"profile":"default","site":"127.0.0.1","block_ads_and_trackers":null}'
  settings list2 '{"type":"site_privacy","version":1}'
  wait_for_line 40 "GUARD privacy later view=b mode=standard" "$ENGINE_LOG"
fi

# Whether the shell ran and finished; each step's page as third first mine
# allowed ok, a letter each (B blocked, L loaded, ? no report); the site the
# shell was told; and what it read at each step, as mode/for/blocked (`?` for
# no report); then the command socket's answers and b's reports after
# them, mode/for each, without repeats (`?` for none).
READ="$(awk '
  /SETTINGS [a-z0-9]+=/ {
    split(substr($0, index($0, "SETTINGS ") + 9), kv, /=/)
    answered[kv[1]] = kv[2]
  }
  match($0, /GUARD privacy later view=b mode=[a-z]* for=[a-z]*/) {
    split(substr($0, RSTART + 27, RLENGTH - 27), f, / /)
    split(f[1], m, /=/); split(f[2], w, /=/)
    if (m[2] "/" w[2] != last) {
      later = later (later == "" ? "" : ",") m[2] "/" w[2]
      last = m[2] "/" w[2]
    }
  }
  /GUARD shell-loaded/ { shell = 1 }
  /GUARD privacy done/ { done = 1 }
  match($0, /GUARD ads as=[a-z0-9-]+( [a-z]+=[a-z]+)+/) {
    n = split(substr($0, RSTART + 10, RLENGTH - 10), f, / /)
    split(f[1], a, /=/)
    for (i = 2; i <= n; i++) {
      split(f[i], kv, /=/)
      ran[a[2] SUBSEP kv[1]] = kv[2]
    }
  }
  match($0, /GUARD privacy step=[0-9] view=[a-z] site=[^ ]* mode=[a-z]* for=[a-z]* blocked=[0-9]+/) {
    split(substr($0, RSTART + 14, RLENGTH - 14), f, / /)
    for (i in f) { split(f[i], kv, /=/); got[kv[1]] = kv[2] }
    read[got["step"] got["view"]] = got["mode"] "/" got["for"] "/" got["blocked"]
    if (site == "") site = got["site"]
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
  function said(key) { return key in read ? read[key] : "?" }
  function answer(key) { return key in answered ? answered[key] : "?" }
  END {
    printf "%d %d %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s %s\n",
      shell, done,
      letters("a1"), letters("a2"), letters("b1"), letters("a3"),
      letters("b2"), letters("b3"), (site == "" ? "?" : site),
      said("1a"), said("2a"), said("3b"), said("4a"), said("4b"), said("5b"),
      answer("set1"), answer("list1"), answer("set2"), answer("list2"),
      (later == "" ? "?" : later)
  }' "$ANSWERS" "$ENGINE_LOG" 2>/dev/null)"

MEASURED="$READ"
echo
echo "measured: $MEASURED"
echo "  (shell done a1 a2 b1 a3 b2 b3 site, then what the shell read at 1 2 3 4a 4b 5,"
echo "   then Settings' set, list, clear and list, and b's reports after them)"

# Which end to blame. `packages/domicile-engine/tests/test-site-privacy-guard.sh`
# runs the reading and this block directly.
FAILURE=""
PASSED=""
read -r RAN DONE A1 A2 B1 A3 B2 B3 SITE R1 R2 R3 R4A R4B R5 SET1 LIST1 SET2 LIST2 LATER <<<"$MEASURED"
READS="$R1 $R2 $R3 $R4A $R4B $R5"
BLOCKED="BLBLL"
LOADED="LLLLL"
TOLD="standard/profile/2 off/window/0 standard/profile/2 off/site/0 off/site/0 standard/profile/2"
if [ "$RAN" != 1 ]; then
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
elif [ "$DONE" != 1 ]; then
  FAILURE="the shell never finished its steps: a page never loaded, or \
setBlockAdsAndTrackers threw (its line says why), and the engine log has the \
shell's console"
elif [ "$A1" != "$BLOCKED" ]; then
  FAILURE="the first page was not blocked as guard-ad-blocking.sh's are \
($A1): this guard stands on that one, so look there first"
elif [ "$A2" != "$LOADED" ]; then
  FAILURE="AD BLOCKING OFF FOR A WINDOW DID NOT REACH ITS PAGE ($A2): \
SetAdBlockingForWindow never reached the page's PagePrivacy, or the request \
check does not read it (Blocks in domicile_ad_blocking.cc)"
elif [ "$B1" != "$BLOCKED" ]; then
  FAILURE="A WINDOW'S SETTING REACHED ANOTHER WINDOW ($B1): b, on the same \
site, was not blocked after only a's window was turned off, so the mode was \
kept for the site or the profile, not the page (PagePrivacy::SetForWindow)"
elif [ "$A3" != "$LOADED" ] || [ "$B2" != "$LOADED" ]; then
  FAILURE="ad blocking off for the site did not reach both windows' pages \
($A3 $B2): SetSiteAdBlocking kept it for another site than the page's \
(PrivacySiteOf), or PagePrivacy::mode does not read it"
elif [ "$B3" != "$BLOCKED" ]; then
  FAILURE="clearing the site's setting left it off ($B3): SetSiteAdBlocking \
with none did not remove it"
elif [ "$SITE" != "127.0.0.1" ] || [ "$READS" != "$TOLD" ]; then
  FAILURE="the pages were blocked as set, but the shell was told otherwise \
(site $SITE, and $READS for $TOLD): SitePrivacyChanged reports the wrong \
site, mode, source or count, or reports late (ReportSitePrivacy, \
PagePrivacy::Changed)"
elif [ "$SET1" != set ] || [ "$SET2" != set ]; then
  FAILURE="THE COMMAND SOCKET REFUSED A SITE'S AD BLOCKING ($SET1 $SET2), as \
the Settings app sends it: set_site_privacy, or SetDeskSitePrivacy found no \
prefs for the default profile (SitePrivacyPrefsOf); $ANSWERS has its answer"
elif [ "$LIST1" != "default:127.0.0.1:strict" ] || [ "$LIST2" != none ]; then
  FAILURE="Settings' list of sites was wrong ($LIST1, then $LIST2 once \
cleared): site_privacy did not read the profile's sites \
(ListDeskSitePrivacy, SitesWithOwnAdBlocking)"
elif [ "$LATER" != "strict/site,standard/profile" ]; then
  FAILURE="Settings' change did not reach the open page ($LATER): PagePrivacy \
does not watch kSiteAdBlockingPref, or the view does not report it"
else
  PASSED="a page's ad blocking went off for its window only, then for its \
site in both windows, then back to the profile's, as the shell set it, and \
the shell was told each mode, where it came from and how many requests were \
blocked; and the Settings app's list and change reached the page"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-site-privacy: $FAILURE" "$ENGINE_LOG"
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "the command socket answered:" >&2
cat "$ANSWERS" >&2 2>/dev/null
echo "the page server said:" >&2
tail -20 "$HTTP_LOG" >&2
echo "the shell's and the pages' steps, and the blocker's, in order:" >&2
grep -E "GUARD |domicile: ad blocking|domicile: block list" "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
