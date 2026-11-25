#!/usr/bin/env bash
# Unloading a browser window's page, by `discardBrowserWindow` and by a
# shortage of memory. See packages/domicile-engine/docs/GUARDS.md.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-discard.sh /build/chromium/src
#
# Runs headless: nothing here is measured in pixels.
#
# Three engines, one after the other. Their shell is guard-webview-discard.js.
#
# The manual engine has an extension (guard-webview-discard-extension), which
# opens a popup window. The shell asks to unload
# the subject while a <webview> shows it, unmounts it, asks again, asks for the
# popup window and a DevTools window too, and shows the subject again. Checks,
# in order:
#
#   the shell, the subject and the       or nothing was set up
#     extension came up
#   a window a <webview> shows stays     refused in the log, and listed loaded
#   the subject is listed isDiscarded
#   its old page is gone                 it logs nothing between `quiet` and
#                                        `remounting`
#   the popup window and the DevTools    refused in the log
#     window stay
#   shown again, it loads                the page says `restored`, with both
#                                        history entries and its scroll
#   it is listed loaded again
#   a window whose <webview> is mounted  listed isDiscarded, and not loaded
#     and not rendered is unloaded         until it is rendered
#   rendered again, it loads             the same element shows its page
#
# The automatic engine is short of memory, by its feature's parameters, for a
# page hidden a second. The shell mounts three windows and unmounts them:
#
#   `plain` is unloaded
#   `typed` stays                        it holds a user's edit
#
# The handled engine is as short, and its shell listens for that and unloads
# nothing: it hears which windows could go, and the engine leaves them.
#
# NEGATIVE=1 is the control: the manual shell never asks to unload the
# unmounted subject or the hidden window, and the other engines are never
# short. Those pages must live on and not load again, the extension must hear
# nothing, and no window may be unloaded.
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
  annotate "guard-webview-discard: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
DISCARD=1
SHORT="available_percent/100/hidden_for/1s"
if [ "$NEGATIVE" = "1" ]; then
  DISCARD=0
  SHORT="available_percent/0/stalled_percent/101/hidden_for/1s"
fi

# The fixture's id. `packages/domicile-engine/tests/test-webview-discard-guard.sh`
# holds it to the manifest's `key`.
readonly ID="nonaeboobmhpmieioampffbjnpingcop"
EXTENSION="$SCRIPTS/guard-webview-discard-extension"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-webview-discard$WHICH-broker}"
CONTROL="${CONTROL:-/tmp/domicile-webview-discard$WHICH-control}"
PROFILE="${PROFILE:-/tmp/domicile-webview-discard$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-discard$WHICH-engine.log}"
MANUAL_LOG="${ENGINE_LOG%.log}-manual.log"
AUTOMATIC_LOG="${ENGINE_LOG%.log}-automatic.log"
HANDLED_LOG="${ENGINE_LOG%.log}-handled.log"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-webview-discard$WHICH-socket.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-discard$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-120}"
# The shell's window. Without a size the headless window's viewport is empty.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# How long the shell waits between steps. Longer than a page's second to
# scroll, and than content's second to save the scroll.
SETTLE_MS="${SETTLE_MS:-4000}"

STARTED=()
ENGINE=""
cleanup() {
  [ -n "$ENGINE" ] && kill "$ENGINE" 2>/dev/null
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-discard: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-discard: no python3, which serves the pages and the compositor's end of the socket"
  exit 77
}

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The pages, on their own server like every <webview> guard's.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-discard-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-discard: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-discard: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"

# 2. The compositor's end, which names the fixture, for the manual engine.
rm -f "$CONTROL" "$SOCKET_LOG"
python3 "$SCRIPTS/guard-extension-installer-compositor.py" \
  --socket "$CONTROL" --unpacked "$EXTENSION" >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-webview-discard: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

# 3. An engine: runs one, waits for its shell's last step, and ends it. Fails
#    when that step never came. `src` goes last: it is a URL.
engine() { # $1 mode, $2 log, then more switches
  local mode="$1" log="$2"
  shift 2
  fresh_broker
  remove_profile "$PROFILE"
  mkdir -p "$PROFILE"
  rm -f "$log"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --window-size="$WIDTH,$HEIGHT" \
    --app="domicile://shell/?mode=$mode&discard=$DISCARD&settle=$SETTLE_MS&expect=$ID&src=$SUBJECT" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-webview-discard.js" \
    --no-sandbox --password-store=basic --no-first-run --disable-component-update \
    --user-data-dir="$PROFILE" \
    --enable-logging=stderr --log-level=0 \
    "$@" \
    --domicile-broker-socket="$BROKER" >"$log" 2>&1 &
  ENGINE=$!
  local finished=0
  wait_for_line $((FOR_SECONDS * 4)) '"GUARD done"' "$log" || {
    finished=1
    echo "the $mode shell never finished; the verdict below says what that means" >&2
  }
  kill "$ENGINE" 2>/dev/null
  wait "$ENGINE" 2>/dev/null
  ENGINE=""
  return "$finished"
}

# The manual engine has the feature off, so only the shell unloads a page. One
# that did not finish is a failure already, so the next does not run.
rm -f "$AUTOMATIC_LOG" "$HANDLED_LOG"
engine manual "$MANUAL_LOG" --domicile-control-socket="$CONTROL" \
  --disable-features=DomicilePageDiscarding &&
  engine automatic "$AUTOMATIC_LOG" \
    --enable-features="DomicilePageDiscarding:$SHORT" &&
  engine handled "$HANDLED_LOG" \
    --enable-features="DomicilePageDiscarding:$SHORT"

# The readings, each anchored on the quotes Chromium puts around a console
# message.
saw() { # $1 log, $2 fixed string
  grep -qF -- "$2" "$1" 2>/dev/null && echo 1 || echo 0
}
# The lines of a log between two of the shell's steps.
between() { # $1 log, $2 the step it starts at, $3 the one it ends at
  awk -v from="\"GUARD $2\"" -v to="\"GUARD $3\"" '
    index($0, to) { exit }
    inside { print }
    index($0, from) { inside = 1 }' "$1" 2>/dev/null
}
count() { # $1 fixed string, on standard input
  grep -cF -- "$1"
}

SAW_SHELL=$(saw "$MANUAL_LOG" '"GUARD shell-loaded"')
SAW_SUBJECT=$(saw "$MANUAL_LOG" '"GUARD scrolled name=subject-2"')
SAW_EXTENSION=$(saw "$MANUAL_LOG" '"GUARD extension-ready"')
SAW_REMOUNT=$(saw "$MANUAL_LOG" '"GUARD remounting"')
SAW_REFUSED=$(saw "$MANUAL_LOG" "; a <webview> shows it.")
SAW_POPUP_REFUSED=$(saw "$MANUAL_LOG" "; it is an extension's popup window.")
SAW_DEVTOOLS_REFUSED=$(saw "$MANUAL_LOG" "; it is a DevTools window.")
EARLY=$(between "$MANUAL_LOG" asked-attached unmounted |
  count '"GUARD list name=subject-1 discarded=true"')
LISTED=$(between "$MANUAL_LOG" unmounted remounting |
  count '"GUARD list name=subject-1 discarded=true"')
TICKS=$(between "$MANUAL_LOG" quiet remounting |
  count '"GUARD tick name=subject-2"')
LOADED=$(between "$MANUAL_LOG" remounting "done" |
  count '"GUARD loaded name=subject-2"')
RESTORED=$(between "$MANUAL_LOG" remounting "done" |
  count '"GUARD restored name=subject-2 history=2 scroll=1000"')
RELISTED=$(between "$MANUAL_LOG" remounting "done" |
  count '"GUARD list name=subject-1 discarded=false"')

KEPT_LISTED=$(between "$MANUAL_LOG" hidden showing-hidden |
  count '"GUARD list name=kept discarded=true"')
KEPT_EARLY=$(between "$MANUAL_LOG" asked-hidden showing-hidden |
  count '"GUARD loaded name=kept"')
KEPT_LOADED=$(between "$MANUAL_LOG" showing-hidden shown-hidden |
  count '"GUARD loaded name=kept"')
SAW_KEPT=$(saw "$MANUAL_LOG" '"GUARD loaded name=kept"')

SAW_HANDLED=$(saw "$HANDLED_LOG" '"GUARD done"')
HEARD=$(saw "$HANDLED_LOG" '"GUARD short count=')
HANDLED_LISTED=$(saw "$HANDLED_LOG" ' discarded=true"')

SAW_UNMOUNTED=$(saw "$AUTOMATIC_LOG" '"GUARD unmounted"')
SAW_DONE=$(saw "$AUTOMATIC_LOG" '"GUARD done"')
SAW_TYPED=$(saw "$AUTOMATIC_LOG" '"GUARD typed name=typed value=words"')
AUTO_PLAIN=$(saw "$AUTOMATIC_LOG" '"GUARD list name=plain discarded=true"')
AUTO_TYPED=$(saw "$AUTOMATIC_LOG" '"GUARD list name=typed discarded=true"')

echo
echo "manual: shell=$SAW_SHELL subject=$SAW_SUBJECT extension=$SAW_EXTENSION remount=$SAW_REMOUNT"
echo "refused: attached=$SAW_REFUSED early=$EARLY popup=$SAW_POPUP_REFUSED devtools=$SAW_DEVTOOLS_REFUSED"
echo "unloaded: listed=$LISTED ticks=$TICKS"
echo "shown again: loaded=$LOADED restored=$RESTORED listed=$RELISTED"
echo "hidden: page=$SAW_KEPT listed=$KEPT_LISTED early=$KEPT_EARLY loaded=$KEPT_LOADED"
echo "handled: done=$SAW_HANDLED heard=$HEARD listed=$HANDLED_LISTED"
echo "automatic: unmounted=$SAW_UNMOUNTED done=$SAW_DONE typed=$SAW_TYPED"
echo "unloaded: plain=$AUTO_PLAIN typed=$AUTO_TYPED"
echo

# The verdict. `packages/domicile-engine/tests/test-webview-discard-guard.sh` runs this block
# directly.
FAILURE=""
PASSED=""
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw"
elif [ "$SAW_SUBJECT" != "1" ]; then
  FAILURE="the subject's second page never loaded and scrolled, so there was \
no page to unload. That is the guest, or the page server"
elif [ "$SAW_EXTENSION" != "1" ]; then
  FAILURE="the extension never said it was ready: the installer, or its \
tabs.update or windows.create (the log has extension-failed)"
elif [ "$SAW_REMOUNT" != "1" ]; then
  FAILURE="the manual shell never got to showing the subject again. The log \
has shell-failed, or the window list lost a window"
elif [ "$SAW_REFUSED" != "1" ] || [ "$EARLY" != "0" ]; then
  FAILURE="A WINDOW A <webview> SHOWS WAS NOT REFUSED: discardBrowserWindow \
reached DeskWindows::Discard and IsShown said no, or never reached it"
elif [ "$SAW_DONE" != "1" ] || [ "$SAW_UNMOUNTED" != "1" ]; then
  FAILURE="the automatic shell never finished: its windows never loaded (the \
guest, or the page server), or it threw"
elif [ "$SAW_HANDLED" != "1" ]; then
  FAILURE="the handled shell never finished: its windows never loaded (the \
guest, or the page server), or it threw"
elif [ "$SAW_KEPT" != "1" ]; then
  FAILURE="the window that stays mounted never loaded, so that it loads again \
says nothing. That is the guest, or the page server"
elif [ "$SAW_TYPED" != "1" ]; then
  FAILURE="the typed page never had its words, so that it stayed or went says \
nothing about user edits. This is the harness"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$LISTED" != "0" ]; then
    FAILURE="THE CONTROL UNLOADED THE SUBJECT: the shell never asked and it \
was listed unloaded"
  elif [ "$TICKS" = "0" ]; then
    FAILURE="the control's page said nothing while unmounted, so the claim's \
silence is not its unloading"
  elif [ "$LOADED" != "0" ]; then
    FAILURE="the control's page loaded again when it was shown, so the \
claim's load is not its unloading"
  elif [ "$KEPT_LISTED" != "0" ] || [ "$KEPT_LOADED" != "0" ]; then
    FAILURE="THE CONTROL UNLOADED THE HIDDEN WINDOW: the shell never asked, \
and it was listed unloaded or loaded again"
  elif [ "$HEARD" != "0" ]; then
    FAILURE="THE CONTROL'S SHELL HEARD A SHORTAGE: the engine was never short \
of memory"
  elif [ "$AUTO_PLAIN$AUTO_TYPED" != "00" ]; then
    FAILURE="THE CONTROL'S ENGINE UNLOADED A PAGE: it was never short of \
memory, so the claim's unloading is not the shortage's"
  else
    PASSED="the control is sharp: a subject nobody unloads lives on and does \
not load again, and an engine with memory to spare unloads nothing"
  fi
elif [ "$LISTED" != "1" ]; then
  FAILURE="THE SUBJECT WAS NOT UNLOADED: it was never listed isDiscarded. The \
log has why DeskWindows::DiscardWindow refused, or the list never came"
elif [ "$TICKS" != "0" ]; then
  FAILURE="the subject was listed unloaded and its old page ran on: \
DeskWindows::Reap did not destroy it"
elif [ "$SAW_POPUP_REFUSED" != "1" ]; then
  FAILURE="an extension's popup window was not refused, so its page moves \
into the desk's window and the popup closes (DeskWindows::DiscardWindow)"
elif [ "$SAW_DEVTOOLS_REFUSED" != "1" ]; then
  FAILURE="a DevTools window was not refused, so its front end loads again \
inspecting nothing (DeskWindows::DiscardWindow), or it never loaded"
elif [ "$RESTORED" != "1" ]; then
  FAILURE="shown again, the subject did not load with its two history entries \
and its scroll: CopyStateFrom, or AttachWindowTo's WasShown did not load it. \
The GUARD restored line says what it had"
elif [ "$RELISTED" != "1" ]; then
  FAILURE="the subject loaded and is still listed isDiscarded: the Watch did \
not see its navigation start"
elif [ "$KEPT_LISTED" != "1" ]; then
  FAILURE="A MOUNTED WINDOW THAT IS NOT RENDERED WAS NOT UNLOADED: \
WebViewGuest::IsShown said a <webview> shows it"
elif [ "$KEPT_EARLY" != "0" ]; then
  FAILURE="the hidden window's page loaded before it was rendered: \
HTMLWebViewElement::Replaced asked for it at once"
elif [ "$KEPT_LOADED" != "1" ]; then
  FAILURE="rendered again, the hidden window's <webview> did not load its \
page once: HTMLWebViewElement::ShowIfRendered never asked for it"
elif [ "$HEARD" != "1" ]; then
  FAILURE="a listening shell did not hear of the shortage: \
DeskWindows::AskMemoryShort, or DomicileHost::MemoryShort"
elif [ "$HANDLED_LISTED" != "0" ]; then
  FAILURE="the engine unloaded a page though the shell listens: \
PageDiscarding::OnAsked"
elif [ "$AUTO_PLAIN" != "1" ]; then
  FAILURE="a shortage of memory unloaded no plain page: PageDiscarding's \
timer, its candidates, or MayDiscard"
elif [ "$AUTO_TYPED" != "0" ]; then
  FAILURE="a shortage of memory unloaded the page that was typed into \
(MayDiscard's HadUserEdits)"
else
  PASSED="an unmounted window's page is unloaded and loads with its history \
and scroll when it is shown; a shown window, a popup window and a DevTools \
window stay; and a shortage of memory unloads a plain page and leaves the \
typed one, or is the shell's to handle; a mounted window that is not rendered \
is unloaded, and loads when it is rendered"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-discard: $FAILURE"
for log in "$MANUAL_LOG" "$AUTOMATIC_LOG" "$HANDLED_LOG"; do
  echo "the steps in $log:" >&2
  grep -F '"GUARD ' "$log" | grep -vF '"GUARD tick ' | tail -40 >&2
  grep -F "asked to unload" "$log" >&2
  echo "its last words:" >&2
  last_words "$log" >&2
done
echo "the compositor stand-in said:" >&2
tail -20 "$SOCKET_LOG" >&2
exit 1
