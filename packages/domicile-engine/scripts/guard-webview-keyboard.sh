#!/usr/bin/env bash
# A desktop chord, pressed while a browser window holds the keyboard.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-keyboard.sh /build/chromium/src
#
# No nested compositor and no Wayland client, exactly as guard-webview-framing.sh
# runs: nothing here is measured in pixels, so `--ozone-platform=headless` with
# software compositing is the whole of the environment.
#
# WHY THIS EXISTS. All desktop input enters through the chrome page, and a
# browser window takes DOM focus out of it. `BrowserWindow.tsx` calls `view.focus()`, the shell's document then
# receives no key events at all, and both of the shell's shortcut paths die with
# it — the page's own `keydown` listener because there is no keydown, and the
# compositor's claim because the compositor only ever sees the keys the chrome
# forwards. So the chord that would put another window on screen is the one the
# user can no longer press, and Alt-dragging a float stops working for the same
# reason. The fix is a hook in the browser process, on the guest's own
# WebContentsDelegate, and this is the assertion that it works.
#
# A UNIT TEST CANNOT MAKE THIS CLAIM. There is no nested browsing context in
# jsdom, so `view.focus()` steals no keydown and `Alt+Tab` passes in
# `Shell.test.tsx` today — and would keep passing with the whole path removed.
# The claim is "a key pressed at the browser, while a page inside a window has
# the keyboard, reaches the shell", and only a real engine can be asked it.
#
# WHAT IT ASSERTS, in order, because each answer is only worth anything if the
# one before it holds:
#
#   the shell claimed a chord           or nothing was ever asked for
#   there is a page in the window       in the positive run, that a guest was
#                                        made, attached and navigated
#   the element has the keyboard        or the keystroke is being driven at the
#                                        shell and the question is not the one
#                                        this guard asks
#   nothing was relayed                 `grab_shortcut` never crosses the control
#                                        socket: the browser process holds the
#                                        claims now
#   the chord reached the shell         THE CLAIM
#   the modifiers reached the shell     Alt-dragging a float needs exactly this
#   an ungrabbed key reached the guest  measured on the browser side, by the
#     and not the shell's document      modifiers it changed: only the guest's
#                                        own hook can report that
#
# BEFORE AND AFTER, WHICH IS WHAT MAKES THE LAST ONE A MEASUREMENT. "The shell's
# document did not see the key" is worth nothing on its own — a page that never
# receives a key event at all reads exactly the same. So a key is pressed BEFORE
# the window takes the keyboard, and the shell's document must report it; the
# window is handed the keyboard by that keystroke; and the second key must then
# reach the guest and not this document. Where the first key does not arrive
# either, the harness cannot deliver a DOM key event to any page in it and the
# guard says so and decides nothing about the second — the claims about the
# chord are browser-side and do not depend on it.
#
# HOW IT CAN FAIL, which is the part a guard is worth nothing without. NEGATIVE=1
# lays out an <iframe> in place of the <webview>, identically, pointed at the
# same page and driven with the same keystrokes. It takes the keyboard just as
# thoroughly — that is the defect, not the guest — and it has no guest delegate
# behind it, so no chord may fire. That pair separates "the browser process is
# matching the chord" from "this harness is not driving a key at a focused
# window at all", which are the two ways the positive run could be wrong and are
# indistinguishable from inside it.
#
# THE CONTROL'S WINDOW IS EMPTY, and that is measured rather than intended: an
# <iframe> on a domicile:// document does not load the http page the <webview>
# loads happily, so the control demonstrates a focused subframe that is not a
# guest rather than a focused *page* that is not a guest. It is enough for what
# the control is for — the chord is the only reading it decides, and the element
# has the keyboard either way — but it is a difference between the two runs
# beyond the guest, so it is written down here rather than left to be
# rediscovered. `$HTTP_LOG` says whether the page was ever even asked for.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-keyboard: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 puts an <iframe> where the <webview> goes. See the header.
NEGATIVE="${NEGATIVE:-0}"
KIND="webview"
[ "$NEGATIVE" = "1" ] && KIND="iframe"

# Alt+Tab, the chord `Shell.tsx` claims, in every numbering the path needs it
# in: evdev for the claim and for the guard's own arithmetic, a DOM code and key
# for the event, and a VKEY because a keystroke with no `windowsVirtualKeyCode`
# is one Blink cannot name.
CHORD_EVDEV="${CHORD_EVDEV:-15}"
CHORD_CODE="Tab"
CHORD_KEY="Tab"
CHORD_VKEY=9

# And two keys nobody claimed. `b` is pressed before the window has the
# keyboard and `a` after, so the pair is a before and an after. 48 and 30 are
# their evdev codes.
BEFORE_EVDEV=48
BEFORE_CODE="KeyB"
BEFORE_KEY="b"
BEFORE_VKEY=66
PLAIN_EVDEV=30
PLAIN_CODE="KeyA"
PLAIN_KEY="a"
PLAIN_VKEY=65

# Not the framing guard's 8731 and not spike-iframe.sh's 8730: two guards on one
# port is two guards that cannot run in the same job, and CI runs them in one.
PORT="${PORT:-8732}"
DEBUG_PORT="${DEBUG_PORT:-9232}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-keyboard-broker}"
CONTROL="${CONTROL:-/tmp/domicile-webview-keyboard-control}"
PROFILE="${PROFILE:-/tmp/domicile-webview-keyboard-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# How long the shell is given to load, ask for a guest, have one attached and
# navigated, and hand it the keyboard. Generous, because every one of those is
# asynchronous and this machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

# A run and its own negative control are two measurements, so they get two sets
# of logs. Sharing one file means the control's output overwrites the run's and
# the diagnostics print whichever went last — which, when the two disagree, is
# exactly the pair worth reading side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-keyboard$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-keyboard$WHICH-http.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-webview-keyboard$WHICH-socket.log}"
KEY_LOG="${KEY_LOG:-/tmp/domicile-webview-keyboard$WHICH-key.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-keyboard: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-keyboard: no python3, and the page, the control socket and the keystroke are all driven by one"
  exit 77
}

rm -f "$BROKER" "$CONTROL"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# Waits for `$2` to appear in `$3`, for `$1` deciseconds' worth of quarter
# seconds. Every gate in this script is a line in a log, because every one of
# them is something a page or a browser says rather than a file it creates.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page a browser window shows. Its own server rather than a real site,
#    for the reason the framing guard has one: `crux` reaches no arbitrary host.
python3 "$SCRIPTS/guard-webview-keyboard-page.py" --port "$PORT" \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-keyboard: nothing came up on port $PORT" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/keys"
echo "serving a browser window's page at $SUBJECT"

# 2. The compositor's end of the control channel, which here is a stand-in.
#    Without something listening, `ControlChannel` gives up after thirty seconds
#    and closes the page's end — and the claim, the press and the modifiers all
#    travel on it. It is also where "the claim is no longer relayed" is
#    measured: `grab_shortcut` must never appear in its log.
python3 "$SCRIPTS/guard-webview-keyboard-socket.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-webview-keyboard: the control-socket stand-in never listened on $CONTROL" "$SOCKET_LOG"
  tail -20 "$SOCKET_LOG" >&2
  exit 1
}

# 3. The engine, on a domicile:// document, because the browser binds both the
#    control channel and WebViewGuestHost for that origin and no other. `--app`
#    for the reason `domicile` uses it and every guard here repeats: the guard
#    runs the configuration the product runs, or it is guarding something else.
#
#    `--remote-debugging-port` is how the keystroke gets in. There is no
#    keyboard on this machine; see guard-webview-keyboard-key.py for why the
#    path it takes is the same one a real key would.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?kind=$KIND&src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-keyboard.js" \
  --domicile-control-socket="$CONTROL" \
  --remote-debugging-port="$DEBUG_PORT" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD claimed" "$ENGINE_LOG" || {
  annotate_from "guard-webview-keyboard: the shell never claimed a chord, so nothing was asked for" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
echo "the shell claimed Alt+Tab, showing a <$KIND>"

# 4. There has to be a page in the window before any of this means anything.
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# 5. THE BEFORE. A key while the shell still has the keyboard, which the shell's
#    own document must report — and which is also what hands the window the
#    keyboard, so the ordering here is the experiment rather than a convenience.
python3 "$SCRIPTS/guard-webview-keyboard-key.py" \
  --port "$DEBUG_PORT" --code "$BEFORE_CODE" --key "$BEFORE_KEY" \
  --evdev "$BEFORE_EVDEV" --windows-key-code "$BEFORE_VKEY" \
  >"$KEY_LOG" 2>&1 ||
  echo "the first key could not be driven; see $KEY_LOG" >&2

wait_for_line 20 "GUARD document-keydown code=$BEFORE_CODE" "$ENGINE_LOG" ||
  echo "the shell's document never reported the first key" >&2

# 6. Then the keyboard moves. The shell takes it on that keystroke, and on a
#    timer besides, so a harness that delivered no key event still gets here.
wait_for_line "$TRIES" "GUARD window-focused" "$ENGINE_LOG" ||
  echo "the element never became the shell document's activeElement" >&2

# 7. THE AFTER: the chord, and then a key nobody claimed. In that order, so that
#    the modifiers the chord reports are a change from nothing held and the
#    plain key's are a change back — which is what says the guest's hook ran for
#    a key it did not match, and is the only witness of that available here.
python3 "$SCRIPTS/guard-webview-keyboard-key.py" \
  --port "$DEBUG_PORT" --code "$CHORD_CODE" --key "$CHORD_KEY" \
  --evdev "$CHORD_EVDEV" --windows-key-code "$CHORD_VKEY" --alt \
  >>"$KEY_LOG" 2>&1 ||
  echo "the chord could not be driven; see $KEY_LOG" >&2

python3 "$SCRIPTS/guard-webview-keyboard-key.py" \
  --port "$DEBUG_PORT" --code "$PLAIN_CODE" --key "$PLAIN_KEY" \
  --evdev "$PLAIN_EVDEV" --windows-key-code "$PLAIN_VKEY" \
  >>"$KEY_LOG" 2>&1 ||
  echo "the ungrabbed key could not be driven; see $KEY_LOG" >&2

# The press is answered before it is handled: `Input.dispatchKeyEvent` comes
# back when the event has been forwarded, and what this reads is what the page
# logged afterwards. A fixed wait rather than a poll on the line that must
# appear, because two of the four readings below are ABSENCES, and an absence
# cannot be waited for — it can only be given time.
sleep 5

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_CLAIM=$(saw "GUARD claimed")
SAW_PAGE=$(saw "GUARD guest-loaded")
SAW_FOCUS=$(saw "GUARD window-focused")
SAW_SHORTCUT=$(saw "GUARD shortcut keycode=$CHORD_EVDEV alt=true ctrl=false shift=false meta=false")
SAW_MODIFIERS=$(saw "GUARD modifiers alt=true ctrl=false shift=false meta=false")
# The guest's hook running for a key it did NOT match. Nothing else in the
# process reports a modifier set with Alt let go, so this line can only have
# come from PreHandleKeyboardEvent on the guest's delegate.
SAW_HOOK=$(saw "GUARD modifiers alt=false ctrl=false shift=false meta=false")
SAW_SHELL_KEY=$(saw "GUARD document-keydown code=$BEFORE_CODE")
SAW_DOCUMENT_KEY=$(saw "GUARD document-keydown code=$PLAIN_CODE")
SAW_GUEST_KEY=$(saw "GUARD guest-keydown code=$PLAIN_CODE")
SAW_RELAY=$(grep -qF "grab_shortcut" "$SOCKET_LOG" && echo 1 || echo 0)

echo
echo "claimed=$SAW_CLAIM loaded=$SAW_PAGE focused=$SAW_FOCUS relayed=$SAW_RELAY"
echo "shortcut=$SAW_SHORTCUT modifiers=$SAW_MODIFIERS hook-ran-unmatched=$SAW_HOOK"
echo "the shell's document saw: before=$SAW_SHELL_KEY after=$SAW_DOCUMENT_KEY"
echo "the page in the window saw: after=$SAW_GUEST_KEY"
echo

# WHICH END TO BLAME, and it is the whole of this script's judgement. Nine
# readings and two modes make far more answers than a person reading an
# annotation can be expected to reconstruct, and most of the failures read alike
# and mean different things — so they are decided here, in a block
# `scripts/test-webview-keyboard-guard.sh` runs directly, rather than inferred
# from a grep by whoever opens the job.
#
# The order is the order the readings depend on each other in: a run that never
# claimed anything has established nothing about what fires, and a run where the
# window never took the keyboard is not a run about browser windows at all.
FAILURE=""
PASSED=""
if [ "$SAW_CLAIM" != "1" ]; then
  FAILURE="the shell never claimed a chord, so nothing here was ever asked \
for. This is the harness: the page did not run, or navigator.domicile was \
absent, and the engine log has its console"
elif [ "$SAW_FOCUS" != "1" ]; then
  FAILURE="the element never became the shell document's activeElement, so \
the keyboard never left the shell and the keystrokes below were driven at the \
wrong window. This is the harness, not the hook"
elif [ "$SAW_RELAY" = "1" ]; then
  FAILURE="the claim was written to the control socket. It is the browser \
process that holds these now — the compositor sees not one key of a focused \
guest's, so a claim relayed to it is a claim nothing can match"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_SHORTCUT" = "1" ]; then
    FAILURE="a chord fired with an <iframe> in the element's place. There is \
no guest there and so no delegate to match it, which means the press did not \
come from the hook under test and the positive run is measuring something else"
  else
    PASSED="the control is sharp: an ordinary subframe takes the keyboard \
just as thoroughly and nothing fires, so the positive run is measuring the \
guest's hook and not the harness"
  fi
elif [ "$SAW_PAGE" != "1" ]; then
  FAILURE="nothing ever loaded in the window, so there was no page for the \
keyboard to be in and the readings below are about an empty frame. That is the \
guest: it was not made, not attached, or not navigated. The engine's log has \
the browser's own line for an attach, and the http log says whether the page \
was ever asked for"
elif [ "$SAW_SHORTCUT" != "1" ]; then
  FAILURE="the chord never reached the shell. The window had the keyboard and \
the claim was made, so this is the hook: either PreHandleKeyboardEvent did not \
run on the guest's delegate, or it ran and did not match, or the press did not \
come back down the control channel"
elif [ "$SAW_MODIFIERS" != "1" ]; then
  FAILURE="the chord fired and the modifiers did not. The shell reads Alt and \
Shift from this and nothing else while a window has the keyboard, so a float \
that cannot be dragged or resized is what this failure looks like to a user"
elif [ "$SAW_HOOK" != "1" ]; then
  FAILURE="the ungrabbed key never reached the guest's delegate: the hook \
reported no modifier change for it, and nothing else in the process reports \
one. So the key went somewhere else, or nowhere, and where an unhandled key \
ends up is not decided by this run"
elif [ "$SAW_DOCUMENT_KEY" = "1" ]; then
  FAILURE="an ungrabbed key reached BOTH the guest's delegate and the shell's \
document. That is not the answer WebViewGuest::PreHandleKeyboardEvent records \
in its own comment, and it is good news rather than a regression: the shell's \
own non-grabbed keys still work over a browser window. Update that, then this \
arm"
elif [ "$SAW_SHELL_KEY" != "1" ]; then
  # NOT A FAILURE, AND SAYING WHY IS THE POINT. Every claim above is measured
  # in the browser process, where a key is routed and offered to a delegate.
  # Whether it then becomes a DOM event in a page is a layer below, and this
  # browser has no display for its window to be activated on -- so a run where
  # no page receives one is a harness fact rather than a finding. What it costs
  # is the *shell's* half of the last reading: with nothing arriving here
  # before focus moved, nothing arriving after it is not a measurement.
  PASSED="a desktop chord reached the shell while a browser window held the \
keyboard, the modifiers came with it, and an ungrabbed key reached the guest's \
delegate and not the shell. WITH ONE READING SHORT: no key reached the shell's \
document even before the window took focus, so this run cannot tell that \
absence from a page that receives no key events at all, and does not decide \
where an unhandled key ends up"
else
  PASSED="a desktop chord reached the shell while a browser window held the \
keyboard, the modifiers came with it, and an ungrabbed key reached the guest's \
delegate and not the shell's document — which the same document DID receive \
before the window took focus, so that absence is a measurement. That is the \
recorded answer to whether a guest's unhandled keys reach the embedder: they \
do not"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-keyboard: $FAILURE"
echo "the engine's last words:" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the control socket was told:" >&2
tail -20 "$SOCKET_LOG" >&2
echo "what the keystrokes did:" >&2
tail -20 "$KEY_LOG" >&2
exit 1
