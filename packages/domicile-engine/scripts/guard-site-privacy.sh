#!/usr/bin/env bash
# A page's ad blocking, and each protection beside it, can be turned off for
# its window or its site, as a shield in the address bar does, and the shell
# hears how many of its requests were blocked and where each came from.
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
# check reads both (domicile_ad_blocking.cc); `setPrivacyProtection` does the
# same for each protection, which the link check (link_tracking_throttle.cc)
# and device hiding (domicile_device_details.cc) read. The unit tests check
# the prefs; this checks that what a shell sets is what a page gets, for that
# window or that site only, and that what the shell is told matches.
#
# The list and the rule are guard-ad-blocking.sh's, so on standard a page's
# five scripts load as B L B L L (third first mine allowed ok), and with the
# script a redirect takes to `/ads/hop.js`, three are blocked.
# The shell (guard-site-privacy.js) draws two <webview>s, a and b, on the same
# site, and asserted, as the page's scripts and then what the shell read:
#
#   1  a1: B L B L L  standard, for the profile, 3 blocked
#   2  a, off for its window: a2 L L L L L, off for the window, 0 blocked
#   3  b1: B L B L L  b is another window, still standard
#   4  off for the site, from a, a's own cleared:
#      a3 and b2: L L L L L, off for the site, 0 blocked
#   5  b clears the site's: b3 B L B L L, standard for the profile, 3 blocked
#
# then, on the landing page at localhost, as keep fbclid utm_source and the
# links and device protections, each on or off and where from, and the page's
# canvas, pixels and audio against b7's:
#
#   6  a, tracking kept in its window: a6 K K K, off/window, on/profile
#   7  b7: K D K, on/profile, on/profile: b is another window
#   8  both off for the site, from a, a's own cleared:
#      b8 K K K, off/site, off/site, and its device read is not b7's
#   9  b clears the site's: b9 K D K, on/profile, on/profile, and its device
#      read is b7's again
#
# Every step's page is its own control: the step before or after it blocks,
# or removes or hides, on the same site in the same run.
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

# As wait_for_line, for b's last report after the shell was done: one the
# report before it may have said too.
wait_for_later() { # $1 tries, $2 pattern
  for _ in $(seq 1 "$1"); do
    grep -F "GUARD privacy later" "$ENGINE_LOG" 2>/dev/null | tail -1 |
      grep -qF -- "$2" && return 0
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

# 6. As the Settings app does: set b's site, the landing page's, to strict in
#    the default profile from the command socket, list it, then clear it and
#    list again; then the same with only its link tracking. Each time, wait
#    for b's page to be told without a load. Each answer goes to $ANSWERS as
#    `SETTINGS <what>=<answer>`, each site as profile:site:mode, `-` for
#    none, then `:name=on|off` for each protection of its own.
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
    sites = []
    for each in answer["sites"]:
        mode = each["block_ads_and_trackers"]
        sites.append(":".join(
            [each["profile"], each["site"], mode if mode is not None else "-"]
            + ["%s=%s" % (name, "on" if on else "off")
               for name, on in sorted(each.get("protections", {}).items())]))
    print("SETTINGS %s=%s" % (what, ",".join(sites) or "none"))
else:
    print("SETTINGS %s=%s" % (what, answer.get("type")))
    print("  (%s)" % json.dumps(answer))
PY
}
if grep -q "GUARD privacy done" "$ENGINE_LOG" 2>/dev/null; then
  settings set1 '{"type":"set_site_privacy","version":1,"profile":"default","site":"localhost","block_ads_and_trackers":"strict"}'
  settings list1 '{"type":"site_privacy","version":1}'
  wait_for_later 40 "mode=strict for=site links=on/profile"
  settings set2 '{"type":"set_site_privacy","version":1,"profile":"default","site":"localhost","block_ads_and_trackers":null}'
  settings list2 '{"type":"site_privacy","version":1}'
  wait_for_later 40 "mode=standard for=profile links=on/profile"
  settings set3 '{"type":"set_site_privacy","version":1,"profile":"default","site":"localhost","protections":{"remove_tracking_from_links":false}}'
  settings list3 '{"type":"site_privacy","version":1}'
  wait_for_later 40 "mode=standard for=profile links=off/site"
  settings set4 '{"type":"set_site_privacy","version":1,"profile":"default","site":"localhost","protections":{"remove_tracking_from_links":null}}'
  settings list4 '{"type":"site_privacy","version":1}'
  wait_for_later 40 "mode=standard for=profile links=on/profile"
fi

# Whether the shell ran and finished; each step's page as third first mine
# allowed ok, a letter each (B blocked, L loaded, ? no report); the site the
# shell was told; and what it read at each step, as mode/for/blocked (`?` for
# no report); then each landing page as keep fbclid utm_source (K kept, D
# dropped, ? none), what the shell read there as links/for,device/for, and
# b8's and b9's device reads as canvas image audio against b7's (C changed, T
# the same, ? none); then the command socket's answers and b's reports after
# them, mode/for/links/for each, without repeats (`?` for none).
READ="$(awk '
  /SETTINGS [a-z0-9]+=/ {
    split(substr($0, index($0, "SETTINGS ") + 9), kv, /=/)
    answered[kv[1]] = substr($0, index($0, "SETTINGS ") + 9 + length(kv[1]) + 1)
  }
  match($0, /GUARD privacy later view=b mode=[a-z]* for=[a-z]* links=[a-z]*\/[a-z]*/) {
    split(substr($0, RSTART + 27, RLENGTH - 27), f, / /)
    split(f[1], m, /=/); split(f[2], w, /=/); split(f[3], l, /=/)
    if (m[2] "/" w[2] "/" l[2] != last) {
      later = later (later == "" ? "" : ",") m[2] "/" w[2] "/" l[2]
      last = m[2] "/" w[2] "/" l[2]
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
  match($0, /GUARD landed as=[a-z0-9-]+( [a-z_]+=[a-z]+)+/) {
    n = split(substr($0, RSTART + 13, RLENGTH - 13), f, / /)
    split(f[1], a, /=/)
    for (i = 2; i <= n; i++) {
      split(f[i], kv, /=/)
      landed[a[2] SUBSEP kv[1]] = kv[2]
    }
  }
  match($0, /GUARD device as=[a-z0-9-]+( [a-z_]+=[^ "]+)+/) {
    n = split(substr($0, RSTART + 13, RLENGTH - 13), f, / /)
    split(f[1], a, /=/)
    device[a[2]] = 1
    for (i = 2; i <= n; i++) {
      split(f[i], kv, /=/)
      device[a[2] SUBSEP kv[1]] = kv[2]
    }
  }
  match($0, /GUARD privacy step=[0-9] view=[a-z] site=[^ ]* mode=[a-z]* for=[a-z]* blocked=[0-9]+/) {
    split(substr($0, RSTART + 14, RLENGTH - 14), f, / /)
    for (i in f) { split(f[i], kv, /=/); got[kv[1]] = kv[2] }
    read[got["step"] got["view"]] = got["mode"] "/" got["for"] "/" got["blocked"]
    if (site == "") site = got["site"]
  }
  match($0, /GUARD privacy protections step=[0-9] view=[a-z] site=[^ ]* links=[a-z]*\/[a-z]* device=[a-z]*\/[a-z]*/) {
    split(substr($0, RSTART + 26, RLENGTH - 26), f, / /)
    for (i in f) { split(f[i], kv, /=/); had[kv[1]] = kv[2] }
    protected[had["step"] had["view"]] = had["links"] "," had["device"]
    if (landing == "") landing = had["site"]
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
  function reached(as,   out, i, w, how) {
    split("keep fbclid utm_source", w, / /)
    out = ""
    for (i = 1; i <= 3; i++) {
      how = landed[as SUBSEP w[i]]
      out = out (how == "kept" ? "K" : how == "dropped" ? "D" : "?")
    }
    return out
  }
  function versus(as,   out, i, w) {
    if (!(as in device) || !("b7" in device)) return "???"
    split("canvas image audio", w, / /)
    out = ""
    for (i = 1; i <= 3; i++) {
      out = out (device[as SUBSEP w[i]] == device["b7" SUBSEP w[i]] ? "T" : "C")
    }
    return out
  }
  function said(key) { return key in read ? read[key] : "?" }
  function had_(key) { return key in protected ? protected[key] : "?" }
  function answer(key) { return key in answered ? answered[key] : "?" }
  END {
    printf "%d %d %s %s %s %s %s %s %s %s %s %s %s %s %s ",
      shell, done,
      letters("a1"), letters("a2"), letters("b1"), letters("a3"),
      letters("b2"), letters("b3"), (site == "" ? "?" : site),
      said("1a"), said("2a"), said("3b"), said("4a"), said("4b"), said("5b")
    printf "%s %s %s %s %s %s %s %s %s %s %s ",
      reached("a6"), reached("b7"), reached("b8"), reached("b9"),
      (landing == "" ? "?" : landing),
      had_("6a"), had_("7b"), had_("8b"), had_("9b"),
      versus("b8"), versus("b9")
    printf "%s %s %s %s %s %s %s %s %s\n",
      answer("set1"), answer("list1"), answer("set2"), answer("list2"),
      answer("set3"), answer("list3"), answer("set4"), answer("list4"),
      (later == "" ? "?" : later)
  }' "$ANSWERS" "$ENGINE_LOG" 2>/dev/null)"

MEASURED="$READ"
echo
echo "measured: $MEASURED"
echo "  (shell done a1 a2 b1 a3 b2 b3 site, then what the shell read at 1 2 3 4a 4b 5,"
echo "   then a6 b7 b8 b9 landed, the landing site, what the shell read at 6 7 8 9,"
echo "   b8's and b9's device reads against b7's, then Settings' set, list, clear"
echo "   and list, for the mode then for link tracking, and b's reports after them)"

# Which end to blame. `packages/domicile-engine/tests/test-site-privacy-guard.sh`
# runs the reading and this block directly.
FAILURE=""
PASSED=""
read -r RAN DONE A1 A2 B1 A3 B2 B3 SITE R1 R2 R3 R4A R4B R5 \
  L6 L7 L8 L9 LANDING P6 P7 P8 P9 V8 V9 \
  SET1 LIST1 SET2 LIST2 SET3 LIST3 SET4 LIST4 LATER <<<"$MEASURED"
READS="$R1 $R2 $R3 $R4A $R4B $R5"
BLOCKED="BLBLL"
LOADED="LLLLL"
TOLD="standard/profile/3 off/window/0 standard/profile/3 off/site/0 off/site/0 standard/profile/3"
PROTECTED="$P6 $P7 $P8 $P9"
PROTECTED_TOLD="off/window,on/profile on/profile,on/profile off/site,off/site on/profile,on/profile"
if [ "$RAN" != 1 ]; then
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
elif [ "$DONE" != 1 ]; then
  FAILURE="the shell never finished its steps: a page never loaded, or \
setBlockAdsAndTrackers or setPrivacyProtection threw (its line says why), and \
the engine log has the shell's console"
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
elif [ "$L6" != KKK ]; then
  FAILURE="TRACKING KEPT IN LINKS FOR A WINDOW DID NOT REACH ITS PAGE ($L6): \
SetProtectionForWindow never reached the page's PagePrivacy, or the link \
check does not read it (PagePrivacy::IsOnFor in link_tracking_throttle.cc)"
elif [ "$L7" != KDK ]; then
  FAILURE="A WINDOW'S PROTECTION REACHED ANOTHER WINDOW ($L7): b's link kept \
its click id after only a's window kept tracking, so it was kept for the site \
or the profile, not the page (PagePrivacy::SetForWindow), or b's link was \
never cleaned at all, which guard-ad-blocking.sh checks"
elif [ "$L8" != KKK ]; then
  FAILURE="tracking kept in links for the site did not reach another window \
($L8): SetProtectionForSite kept it for another site than the page's, or \
PagePrivacy::IsOnFor does not read kSiteProtectionsPref"
elif [ "$V8" != CCC ]; then
  FAILURE="DEVICE DETAILS WERE STILL HIDDEN WITH THE SITE'S HIDING OFF ($V8, \
canvas image audio against b7's): domicile_device_details.cc does not ask \
PagePrivacy::IsOnFor, or the site's setting was not kept"
elif [ "$L9" != KDK ] || [ "$V9" != TTT ]; then
  FAILURE="clearing the site's protections left them off ($L9, and $V9 \
against b7's): SetSiteProtection with none did not remove them"
elif [ "$LANDING" != localhost ] || [ "$PROTECTED" != "$PROTECTED_TOLD" ]; then
  FAILURE="the pages got their protections as set, but the shell was told \
otherwise (site $LANDING, and $PROTECTED for $PROTECTED_TOLD): \
ReportSitePrivacy reports the wrong protections or their sources"
elif [ "$SET1" != set ] || [ "$SET2" != set ] || [ "$SET3" != set ] ||
  [ "$SET4" != set ]; then
  FAILURE="THE COMMAND SOCKET REFUSED A SITE'S PRIVACY ($SET1 $SET2 $SET3 \
$SET4), as the Settings app sends it: set_site_privacy, or \
SetDeskSitePrivacy found no prefs for the default profile \
(SitePrivacyPrefsOf); $ANSWERS has its answer"
elif [ "$LIST1" != "default:localhost:strict" ] || [ "$LIST2" != none ] ||
  [ "$LIST3" != "default:localhost:-:remove_tracking_from_links=off" ] ||
  [ "$LIST4" != none ]; then
  FAILURE="Settings' list of sites was wrong ($LIST1, then $LIST2 once \
cleared, then $LIST3 with only its link tracking, then $LIST4): \
site_privacy did not read the profile's sites (ListDeskSitePrivacy, \
SitesWithOwnPrivacy)"
elif [ "$LATER" != "strict/site/on/profile,standard/profile/on/profile,standard/profile/off/site,standard/profile/on/profile" ]; then
  FAILURE="Settings' change did not reach the open page ($LATER): PagePrivacy \
does not watch kSiteAdBlockingPref or kSiteProtectionsPref, or the view does \
not report it"
else
  PASSED="a page's ad blocking went off for its window only, then for its \
site in both windows, then back to the profile's, as the shell set it, and \
so did its link tracking and device hiding; the shell was told each, where \
it came from and how many requests were blocked; and the Settings app's list \
and changes reached the page"
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
