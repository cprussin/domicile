#!/usr/bin/env bash
# A plain Escape, pressed at the shell, with a browser window on the page.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-escape.sh /build/chromium/src
#
# No nested compositor and no Wayland client, exactly as guard-webview-keyboard.sh
# runs: nothing here is measured in pixels, so `--ozone-platform=headless` with
# software compositing is the whole of the environment.
#
# WHY THIS EXISTS. It killed a desktop. A `<webview>` makes its page a guest,
# and content builds a `BrowserPluginEmbedder` on the embedder's WebContents the
# moment one is attached — see `BrowserPluginGuest::Init`. Every key the shell's
# own page does not handle comes back to `WebContentsImpl::HandleKeyboardEvent`,
# which offers it to that object first, and for a plain Escape — and for no
# other key — the object walks the browser context's
# `BrowserPluginGuestManager`. This fork has none: it depends on neither
# //extensions nor //components/guest_view, so `ProfileImpl::GetGuestManager`
# answers null, and `BrowserPluginEmbedder::HandleKeyboardEvent` is the one of
# its four methods that does not check. So the browser process dereferenced null
# and the whole desktop went down, restarted, and did it again on the next
# Escape — with a browser window open, which is the only state it needs.
#
# Patch 0037 is the fix and `upstream/browser-plugin-embedder-null-guest-manager.md`
# is the bug report behind it.
#
# A UNIT TEST CANNOT MAKE THIS CLAIM. The defect is in content, three layers
# under anything this repository's own tests reach: it needs a real guest
# attached to a real embedder, an unhandled key routed back out of a renderer,
# and a browser context with no guest manager in it. Only an engine has all
# three, and what it does with them is crash.
#
# WHAT IT ASSERTS, in order, because each answer is only worth anything if the
# one before it holds:
#
#   there is a page in the window     so a guest was made, attached and
#                                      navigated — which is what makes the
#                                      shell's WebContents an embedder at all,
#                                      and without it the press below is a
#                                      press at an ordinary browser
#   a key can be driven at all        or the keystroke under test never left
#                                      the harness
#   nothing dumped a signal           THE CLAIM
#   the browser still answers one     because a process that died without
#                                      dumping a signal is a browser that is
#                                      just as gone, and reading only the log
#                                      would call it a pass
#
# THE KEYBOARD STAYS IN THE SHELL, and that is the experiment rather than a
# simplification. `guard-webview-escape.js` never calls `view.focus()`: the
# crash is on the EMBEDDER's WebContents, and a key sent to a focused guest is
# answered by the guest's own — which has no embedder behind it and cannot
# reach the defect. So this guard is the keyboard guard's mirror image, and the
# window is left unfocused on purpose.
#
# HOW IT CAN FAIL, which is the part a guard is worth nothing without. The claim
# is an ABSENCE — no signal, and a browser still there — and an absence read on
# its own proves nothing, because "the engine survived" and "this guard cannot
# see a dead engine" are the same reading. So NEGATIVE=1 runs the same setup,
# the same page and the same first keystroke, and then kills the browser process
# with SIGSEGV instead of pressing Escape. Both readings must move: the signal
# must appear in the log, and the keystroke afterward must fail. A control that
# passes with either of them unchanged is a control that has established that
# one of the guard's two eyes is shut.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-escape: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 kills the browser instead of pressing Escape. See the header.
NEGATIVE="${NEGATIVE:-0}"

# THE PRESS. Escape in every numbering the path needs it in: a DOM code and key
# for the event, evdev 1 because the driver computes the XKB keycode from it,
# and VKEY_ESCAPE because `windows_key_code` is what content compares against
# and a keystroke Blink cannot name is one that never reaches the branch.
ESCAPE_EVDEV=1
ESCAPE_CODE="Escape"
ESCAPE_KEY="Escape"
ESCAPE_VKEY=27

# And two ordinary keys, one before the Escape and one after it. The first says
# a key can be driven at this browser at all; the second says the browser is
# still there to drive one at. 48 and 30 are their evdev codes.
BEFORE_EVDEV=48
BEFORE_CODE="KeyB"
BEFORE_KEY="b"
BEFORE_VKEY=66
AFTER_EVDEV=30
AFTER_CODE="KeyA"
AFTER_KEY="a"
AFTER_VKEY=65

# Nobody else's ports: two guards on one port is two guards that cannot run in
# the same job, and CI runs them in one.
PORT="${PORT:-8737}"
DEBUG_PORT="${DEBUG_PORT:-9236}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-escape-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-escape-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# How long the shell is given to load, ask for a guest, have one attached and
# navigated. Generous, because every one of those is asynchronous and this
# machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

# How long the browser is given to dump a stack after the press or the signal.
# A fixed wait rather than a poll on the line, because in the run that matters
# the line must never appear and an absence can only be given time.
#
# FIVE IS ENOUGH AND IS NOT A GUESS AT A TIMEOUT. The fault is synchronous with
# the keystroke's own acknowledgment, and Chromium's signal handler writes the
# whole stack before the process leaves it, so there is no pipeline here to
# drain -- this is a flush, not a race. It is also not the reading that carries
# the weight: the keystroke after it is a POSITIVE answer about a live browser,
# and no length of silence is asked to stand in for one. Both runs pay it once,
# which is why this needs no `lib-control-budget.sh`.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

# A run and its own control are two measurements, so they get two sets of logs.
# Sharing one file means the control's output overwrites the run's and the
# diagnostics print whichever went last — which, when the two disagree, is
# exactly the pair worth reading side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-escape$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-escape$WHICH-http.log}"
KEY_LOG="${KEY_LOG:-/tmp/domicile-webview-escape$WHICH-key.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-escape: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-escape: no python3, and the page in the window and the keystrokes are all driven by one"
  exit 77
}

rm -f "$BROKER"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# Waits for `$2` to appear in `$3`, for `$1` quarter seconds. Every gate in
# this script is a line in a log, because every one of them is something a page
# or a browser says rather than a file it creates.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page the browser window shows. Its own server rather than a real site,
#    for the reason the framing guard has one: `crux` reaches no arbitrary host.
#    Shared with the keyboard and click guards, which need the same thing of it.
python3 "$SCRIPTS/guard-webview-guest-page.py" --port "$PORT" \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-escape: nothing came up on port $PORT" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT/page"
echo "serving a browser window's page at $SUBJECT"

# 2. The engine, on a domicile:// document, because the browser binds
#    WebViewGuestHost for that origin and no other — a <webview> anywhere else
#    cannot ask for a guest at all. `--app` for the reason `domicile` uses it
#    and every guard here repeats: the guard runs the configuration the product
#    runs, or it is guarding something else.
#
#    `--remote-debugging-port` is how the keystrokes get in. There is no
#    keyboard on this machine; see guard-webview-keyboard-key.py for why the
#    path they take is the same one a real key would.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?src=$SUBJECT" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-escape.js" \
  --remote-debugging-port="$DEBUG_PORT" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE=$!
STARTED+=("$ENGINE")

# 3. There has to be a page in the window before any of this means anything: a
#    guest is what makes the shell's WebContents an embedder, and an embedder
#    is what the press is offered to.
TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD guest-loaded" "$ENGINE_LOG" ||
  echo "nothing ever loaded in the window" >&2

# 4. A key first, so that a run where the keystroke under test went nowhere is
#    told apart from one where it went in and did no harm.
press() { # $1 code, $2 key, $3 evdev, $4 vkey
  python3 "$SCRIPTS/guard-webview-keyboard-key.py" \
    --port "$DEBUG_PORT" --code "$1" --key "$2" \
    --evdev "$3" --windows-key-code "$4" >>"$KEY_LOG" 2>&1
}

: >"$KEY_LOG"
PRESSED_BEFORE=0
press "$BEFORE_CODE" "$BEFORE_KEY" "$BEFORE_EVDEV" "$BEFORE_VKEY" &&
  PRESSED_BEFORE=1
[ "$PRESSED_BEFORE" = "1" ] ||
  echo "the first key could not be driven; see $KEY_LOG" >&2

# 5. THE PRESS — or, in the control, the signal it stands in for. One
#    substitution and nothing else differs between the two runs.
if [ "$NEGATIVE" = "1" ]; then
  echo "killing the browser process with SIGSEGV instead of pressing Escape"
  kill -SEGV "$ENGINE" 2>/dev/null
else
  echo "pressing $ESCAPE_CODE at the shell, with a browser window on the page"
  # Its status is deliberately not a reading. A browser that dies under this
  # press closes the connection the answer would have come back on, so an error
  # here is what BOTH the crash and an undeliverable keystroke look like — and
  # the two readings below tell them apart, where this cannot.
  press "$ESCAPE_CODE" "$ESCAPE_KEY" "$ESCAPE_EVDEV" "$ESCAPE_VKEY" ||
    echo "the Escape press came back an error; see $KEY_LOG" >&2
fi

sleep "$SETTLE_SECONDS"

# 6. And a key afterward, which is the reading the log cannot give: a browser
#    that answers one is a browser that is still running.
PRESSED_AFTER=0
press "$AFTER_CODE" "$AFTER_KEY" "$AFTER_EVDEV" "$AFTER_VKEY" &&
  PRESSED_AFTER=1

SAW_GUEST=$(grep -qF "GUARD guest-loaded" "$ENGINE_LOG" && echo 1 || echo 0)
# Chromium's own signal handler, which prints this and the stack under it from
# whichever process took the signal. The stack says which process that was, and
# in the run this guard exists for it said `content::BrowserMain`.
SAW_CRASH=$(grep -qF "Received signal" "$ENGINE_LOG" && echo 1 || echo 0)

echo
echo "guest=$SAW_GUEST before=$PRESSED_BEFORE crash=$SAW_CRASH after=$PRESSED_AFTER"
echo

# WHICH END TO BLAME, and it is the whole of this script's judgment. Four
# readings and two modes make more answers than a person reading an annotation
# can be expected to reconstruct, and the two failures that look most alike —
# an engine that crashed and an engine that was never set up to — mean opposite
# things. So they are decided here, in a block
# `scripts/test-webview-escape-guard.sh` runs directly, rather than inferred
# from a grep by whoever opens the job.
#
# The order is the order the readings depend on each other in, and the control
# is gated on the same two setup readings as the run because its setup is the
# run's: one substitution, and everything before it identical.
FAILURE=""
PASSED=""
if [ "$SAW_GUEST" != "1" ]; then
  FAILURE="nothing ever loaded in the browser window, so there was no guest \
and the shell's WebContents was never made an embedder — which is the object \
the press under test is offered to. Nothing here was measured. That is the \
guest: it was not made, not attached, or not navigated; the engine's log has \
the browser's own line for an attach, and the http log says whether the page \
was ever asked for"
elif [ "$PRESSED_BEFORE" != "1" ]; then
  FAILURE="a key could not be driven at this browser at all, so the keystroke \
under test never left the harness and nothing below is a measurement. This is \
the harness: the debugging port, or the shell's page not being the target the \
driver picks"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_CRASH" != "1" ]; then
    FAILURE="the control killed the browser process with SIGSEGV and no signal \
reached the engine's log. So this guard cannot see a crash, the positive run's \
silence is the same silence, and the run establishes nothing. Chromium's stack \
dumping is what is missing — an official build installs no handler"
  elif [ "$PRESSED_AFTER" = "1" ]; then
    FAILURE="the control killed the browser process and a keystroke afterward \
was still answered. The debugging port is then answering for something other \
than the browser under test — a second engine, or a port that outlived it — \
and the positive run's liveness reading rests on it"
  else
    PASSED="the control is sharp: a browser process that dies takes both \
readings with it — the signal reaches the log and the keystroke after it is \
refused — so the positive run's silence is a measurement rather than a blind \
spot"
  fi
elif [ "$SAW_CRASH" = "1" ]; then
  FAILURE="a process dumped a signal. A plain Escape at a shell with a browser \
window on it is what this guard presses, and the last time that crashed it was \
browser_plugin_embedder.cc walking a null BrowserPluginGuestManager — the fork \
has no guest manager, and HandleKeyboardEvent is the one method there that does \
not check. Patch 0037 is the fix; read the dumped stack before assuming it is \
the same one"
elif [ "$PRESSED_AFTER" != "1" ]; then
  FAILURE="no signal was dumped and the browser stopped answering the \
debugging port anyway, so it went away without saying why. Not the crash this \
guard is about — read the end of the engine's log for what it was doing"
else
  PASSED="a plain Escape pressed at the shell, with a guest attached and the \
keyboard still in the shell's own document, left the browser process running \
and dumped no signal"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-escape: $FAILURE"
echo "the engine's last words:" >&2
tail -40 "$ENGINE_LOG" >&2
echo "what the keystrokes did:" >&2
tail -20 "$KEY_LOG" >&2
exit 1
