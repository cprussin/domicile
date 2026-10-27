#!/usr/bin/env bash
# A browser window drawn in a `<webview>` that moves in the shell's document
# is shown again where it lands.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-moved.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the page's `document.visibilityState` and the browser's attach lines from
# the engine's log, so it needs no pixels and no client.
#
# Why: manganese draws its windows as one keyed list, and React moves a
# window's node with `insertBefore` when the list reorders, as it does when a
# window crosses monitors. A move removes the element's frame, so content
# detaches the page and hides it. The element must ask for the page again from
# its new frame (`HTMLWebViewElement::RemovedFrom`); when it kept its old
# binding, the window froze for good and a reload did not help.
#
# The shell draws one browser window, then moves its box three times, each
# `SETTLE_MS` apart. Asserted:
#
#   the shell page ran            or nothing was set up
#   the page loaded               a window was opened and navigated
#   the shell moved the box       every move ran, then the shell settled
#   attached after every move     the browser attached the window once at
#                                 first and once per move
#   visible at the end            the page's last state is `visible`
#
# Control: NEGATIVE=1 never moves the box. The page must still be visible and
# attached once, so the claim's hidden page is the move's doing.
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
  annotate "guard-webview-moved: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 never moves the box. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="moved"
MOVES=3
[ "$NEGATIVE" = "1" ] && MODE="still" && MOVES=0

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-webview-moved$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-moved$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-moved$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-moved$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"
# The shell's window. Without a size the headless window's viewport is empty,
# so the <webview> is out of it and its page is occluded, which reads `hidden`
# too.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# How long the shell waits after attaching, between moves and after the last,
# so each attach and visibility change has landed before the next step.
SETTLE_MS="${SETTLE_MS:-3000}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-moved: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-moved: no python3, which serves the page"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page, on its own server like every <webview> guard's: `crux` reaches
#    no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-hidden-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-moved: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-moved: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT"

# 2. The engine. `src` goes last: it is a URL.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size="$WIDTH,$HEIGHT" \
  --app="domicile://shell/?moves=$MOVES&settle=$SETTLE_MS&src=$SUBJECT/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-moved.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 3. Wait for the shell to settle after its moves.
TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD settled" "$ENGINE_LOG" ||
  echo "the shell never settled; the verdict below says what that means" >&2

saw() { # $1 pattern
  grep -qF -- "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

# Whether every move ran, whether the browser attached the window once at first
# and once per move, and the page's last state (`none` for none).
READ="$(awk -v moves="$MOVES" '
  match($0, /GUARD state=[a-z]+/) {
    state = substr($0, RSTART + 12, RLENGTH - 12)
  }
  /GUARD moved/ { moved++ }
  /GUARD settled/ { settled = 1 }
  /domicile: attached browser window/ { attaches++ }
  END {
    printf "%d %d %s\n", (settled && moved == moves), (attaches == moves + 1),
      (state == "" ? "none" : state)
  }' "$ENGINE_LOG" 2>/dev/null)"

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD page-loaded")

MEASURED="$MODE $SAW_SHELL $SAW_PAGE $READ"
echo
echo "measured: $MEASURED"
echo "  (mode shell page moved-and-settled attached-each-time last-state)"

# Which end to blame. `packages/domicile-engine/tests/test-webview-moved-guard.sh` runs this block
# directly. MEASURED is "<mode> <shell> <page> <steps> <attaches> <last>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"moved 1 1 1 1 visible")
  PASSED="a browser window's page is attached again and visible after its \
<webview> moved three times in the shell's document"
  ;;
"still 1 1 1 1 visible")
  PASSED="the control is sharp: the same window in a box that never moved \
was attached once and stayed visible, so a hidden page in the claim is the \
move's doing"
  ;;
"moved 0 "* | "still 0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
"moved 1 0 "* | "still 1 0 "*)
  FAILURE="the page never loaded: openBrowserWindow opened no window \
('opened browser window' in the log) or the list never reached the shell"
  ;;
"moved 1 1 0 "* | "still 1 1 0 "*)
  FAILURE="the shell never finished its moves, because its <webview> never \
reported a page: the window was not attached at first (AttachToElement, \
AttachWindowTo, ReportEverything)"
  ;;
"moved 1 1 1 0 "*)
  FAILURE="A MOVED <webview> NEVER GOT ITS WINDOW BACK: the browser did not \
attach the window once per move, so the page stays detached and hidden and the \
window freezes. A move removes the element's frame; the element must drop its \
guest binding then and ask again from its new frame \
(HTMLWebViewElement::RemovedFrom, RequestGuest, WebViewGuestHost::CreateGuest)"
  ;;
"moved 1 1 1 1 "*)
  FAILURE="the window was attached again after every move but its page was \
not visible at the end: nothing showed the guest on attach \
(AttachWindowTo's WasShown), or the <webview> was out of the shell's viewport"
  ;;
"still 1 1 1 "*)
  FAILURE="the control's page, in a box that never moved, was not attached \
once or not visible at the end, so the claim says nothing about moving"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED) -- \
the page never said its state, or the run did not get as far as reading"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-moved: $FAILURE" "$ENGINE_LOG"
echo "the page's states, the shell's steps and the attaches, in order:" >&2
grep -E "GUARD (state=|attached|moved|settled)|domicile: (attached|browser window)" "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
