#!/usr/bin/env bash
# Checks that a <webview> counts the elements in its page that match a CSS
# selector, in the page's document rather than the shell's.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-count-matches.sh /build/chromium/src
#
# - The shell counts `body > script` in the guest page, which has one, and
#   `webview`, which the page has none of and the shell one. It also counts
#   `[`, which must throw a SyntaxError.
# - Headless: counting draws nothing.
# - Control (`NEGATIVE=1`): count `body > video`, which the page has none of.
#   It must count 0, or the positive run's 1 proves nothing.
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
  annotate "guard-webview-count-matches: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
SELECTOR="body%20%3E%20script"
WANT=1
[ "$NEGATIVE" = "1" ] && SELECTOR="body%20%3E%20video" && WANT=0

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-count-matches-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-count-matches-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
FOR_SECONDS="${FOR_SECONDS:-90}"

# A run and its control keep separate logs so a failure can compare them.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-count-matches$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-count-matches$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-count-matches: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-count-matches: no python3, and the page in the window is served by one"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page a browser window shows.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-guest-page.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-count-matches: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-count-matches: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"

# 2. The engine, showing the shell module as a domicile:// document.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?src=$SUBJECT&selector=$SELECTOR" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-count-matches.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell page never ran" >&2
for _ in $(seq 1 "$TRIES"); do
  grep -qE "GUARD (counted|never-counted|threw)" "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}
# The number after `GUARD counted <what>=`, or nothing.
counted() { # $1 what
  grep -o "GUARD counted .*" "$ENGINE_LOG" | head -1 |
    grep -o "\b$1=[0-9]*" | head -1 | cut -d= -f2
}

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_BAD_SELECTOR=$(saw "GUARD bad-selector name=SyntaxError")
COUNTED="$(counted n)"
VIEWS="$(counted views)"

echo
echo "shell=$SAW_SHELL bad selector refused=$SAW_BAD_SELECTOR"
echo "selector=$SELECTOR counted=$COUNTED (want $WANT) webviews=$VIEWS"
echo

# The verdict. `scripts/test-webview-count-matches-guard.sh` runs this block.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran: the harness did not load the module, or \
it threw"
elif [ "$SAW_BAD_SELECTOR" != "1" ]; then
  FAILURE="countMatches(\"[\") did not throw a SyntaxError: \
HTMLWebViewElement::countMatches took a selector that does not parse"
elif [ -z "$COUNTED" ]; then
  FAILURE="countMatches() never counted: the element has no countMatches, or \
WebViewGuest.CountMatches gave no number. The engine log has the shell's last \
reason"
elif [ "$VIEWS" != "0" ]; then
  FAILURE="countMatches(\"webview\") counted $VIEWS: it counted in the \
shell's document rather than the page's"
elif [ "$COUNTED" != "$WANT" ]; then
  FAILURE="countMatches counted $COUNTED where the page has $WANT: \
CountMatchesScript in page_matches.cc did not count the selector it was given"
elif [ "$NEGATIVE" = "1" ]; then
  PASSED="a selector the page has none of counts 0"
else
  PASSED="the page's one script counts 1, in the page's document"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-count-matches: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
