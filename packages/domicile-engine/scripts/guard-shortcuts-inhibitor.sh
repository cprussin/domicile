#!/usr/bin/env bash
# The request that takes the host compositor's shortcuts away, on the wire.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-shortcuts-inhibitor.sh /build/chromium/src
#
# WHAT THIS PROVES, AND IT IS ONE SENTENCE. The engine asked the host
# compositor to stop matching its own keyboard shortcuts while this window has
# the keyboard — `zwp_keyboard_shortcuts_inhibit_manager_v1.inhibit_shortcuts`,
# sent over the surface the desktop's window is.
#
# WHAT IT DOES NOT PROVE, and no wording in it may suggest otherwise: that a
# key was pressed, that the host honored the inhibitor, that a binding it would
# have matched went unmatched, or that a shell's Meta chord reached the page.
# Every one of those needs a key put into the nested compositor and an answer
# about which side took it, and this reads a request rather than a keystroke.
# `guard-shortcuts-inhibitor-chord.sh` is that measurement, and it is a guard of
# its own so that this one's pass goes on meaning exactly one thing.
#
# WHY A REQUEST IS WORTH GUARDING ANYWAY. Patch `0038` is what makes a shell's
# Meta chords reach a nested desktop at all, and until this ran, nothing in the
# repository observed any part of it: a host compositor matches its bindings
# BEFORE it sends a key to the focused client, so the whole failure is silent
# on both sides — no log line, no error, a shell that simply looks broken. The
# engine asking is the first link in that chain and the only one this machine
# can see. The reading is cheap and the thing it would catch is a patch that
# stopped being applied, a switch that stopped being read, or a call site that
# moved out from under `SetUpShellIntegration()`.
#
# WHY `WAYLAND_DEBUG` IS THE INSTRUMENT. The request is made by the browser
# process against the host's connection, and it produces nothing anywhere else:
# no page can see it, the compositor under test is not a party to it, and the
# fork logs only the two ways it can FAIL. libwayland writes every message it
# sends when `WAYLAND_DEBUG` is set —
# `zwp_keyboard_shortcuts_inhibit_manager_v1#23.inhibit_shortcuts(new id
# zwp_keyboard_shortcuts_inhibitor_v1#41, wl_surface#30, wl_seat#14)` — and that
# dump is the only window onto this conversation from outside it. What the line
# looks like around the message has moved between libwayland versions, which is a
# thing this guard has already been caught by; `normalized` and the patterns
# beside it are where that is dealt with.
#
# THE SEAT NEEDS A KEYBOARD, WHICH A HEADLESS SESSION HAS NOT GOT. The fork
# asks `WaylandSeat::keyboard()` before it asks for anything — it drives
# upstream's `WaylandKeyboard::CreateShortcutsInhibitor` — and sway advertises
# `WL_SEAT_CAPABILITY_KEYBOARD` only while an input device backs it
# (`seat_update_capabilities`). `under-wayland.sh` runs the headless backend
# with `WLR_LIBINPUT_NO_DEVICES=1`, so there is no such device and the engine
# takes its "no keyboard on the seat" arm instead of asking. So this guard
# brings one: `wtype` creates a `zwp_virtual_keyboard_v1` on the host's seat
# and then sleeps, which is what makes the capability appear. It holds the
# keyboard open for the whole run because the request is made once, where the
# toplevel is set up, and a capability that arrives afterward is too late.
#
# THE KEY IT PRESSES IS NOT A READING. `wtype` builds the keymap it must upload
# out of the keys it was asked for, so a run that types nothing uploads an empty
# one; `-k Shift_L` is what keeps that keymap a keymap. It is pressed before the
# engine is started, at a compositor with nothing focused, and nothing in this
# script looks at where it went. A key that arrives somewhere is the measurement
# this guard does not make.
#
# WHAT IT READS, all of it off the engine's own `WAYLAND_DEBUG` capture, and
# each line only worth anything if the one above it holds:
#
#   a wire dump at all            or every grep below answers "no" about a file
#                                  libwayland never wrote to, which reads as a
#                                  request that was not made
#   a toplevel was made           `SetUpShellIntegration()` runs where the
#                                  toplevel does, so a run with no window in it
#                                  never reached the call site
#   the host carries the protocol  `zwp_keyboard_shortcuts_inhibit_manager_v1`
#                                  in the registry, or there is nothing to ask
#   the seat announced a keyboard  `wl_seat.get_keyboard`, which Chromium sends
#                                  only on the capability — the virtual
#                                  keyboard above is what puts it there
#   `inhibit_shortcuts` was sent   THE CLAIM
#
# HOW IT CAN FAIL. `NEGATIVE=1` is the same run with
# `--domicile-inhibit-host-shortcuts` left off, and the request must then be
# absent. One switch is the whole difference between the two runs, and that is
# what makes it a control worth having: it establishes that the grep is reading
# a request the SWITCH caused rather than one every nested chrome makes —
# which is the fork's own claim about where the decision lives
# (`packages/domicile-launch/src/spawn.rs`, and patch `0038`'s header). Its
# four setup readings are the positive run's, because a control that saw no
# wire, no window or no keyboard is an absence with nothing behind it.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-compositor-cleanup.sh
. "$SCRIPTS/lib-compositor-cleanup.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shortcuts-inhibitor: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs the same thing without the switch. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-shortcuts-inhibitor-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shortcuts-inhibitor-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# How long the engine is given to put a toplevel on the host. Generous, because
# a cold start on a shared machine is most of it and the poll ends the moment
# the line lands.
FOR_SECONDS="${FOR_SECONDS:-90}"

# How long to wait after the toplevel before reading the capture. The request
# is made in `SetUpShellIntegration()`, on the same call path that creates the
# toplevel, so this is a flush and not a race — but the control is looking for
# an ABSENCE, and an absence can only be given time. Both runs pay it once,
# which is why this needs no `lib-control-budget.sh`.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

# Longer than the whole run, because the virtual keyboard must outlive the
# moment the window is mapped and a keyboard that goes away mid-run takes the
# seat's capability with it. `cleanup` is what ends it; this is only the
# backstop for a guard killed outright, whose trap never runs.
KEYBOARD_LIVES_FOR_MS="${KEYBOARD_LIVES_FOR_MS:-300000}"

# A run and its own control are two measurements, so they get two sets of logs.
# Sharing one means the control's output overwrites the run's and the
# diagnostics print whichever went last — which, when the two disagree, is
# exactly the pair worth reading side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shortcuts-inhibitor$WHICH-engine.log}"
KEYBOARD_LOG="${KEYBOARD_LOG:-/tmp/domicile-shortcuts-inhibitor$WHICH-keyboard.log}"

# WHAT EACH READING IS, AS A PATTERN, because a grep that matches nothing
# answers in the same voice as a request that was never sent. Named rather than
# written into the greps below, so that
# `scripts/test-shortcuts-inhibitor-guard.sh` can run them against the shape
# libwayland writes, in both of the shapes it has written it in.
#
# A MESSAGE NAME RATHER THAN A DIRECTION MARKER, and that is a decision rather
# than laziness. libwayland marks a request with ` -> ` and an event with
# nothing, and the marker's spelling has moved between versions — but
# `get_registry`, `get_toplevel`, `get_keyboard` and `inhibit_shortcuts` are
# REQUEST names in their protocols and no event anywhere is called any of them,
# so a line carrying one is a line this client sent. Nothing needs the arrow to
# know that, and depending on it is how this guard read a capture it was looking
# straight at as no capture at all.
#
# What must still be told apart is the interface NAME from a message on it:
# binding the manager is what every nested chrome does whatever the switch says,
# and `zwp_keyboard_shortcuts_inhibitor_v1.active` comes back from the
# COMPOSITOR. Neither carries `.inhibit_shortcuts`, which is why the claim is
# spelled with the dot.
#
# The manager is read as a registry event for a reason the others do not have:
# `--enable-logging=stderr` puts the engine's own lines in this same file, and
# the one patch `0038` logs when the host has NOT got the protocol NAMES the
# protocol. A pattern that took the interface name anywhere would read a missing
# manager as a present one — and the control would then pass over a host that
# could not have answered the request at all.
#
# `[@#]` because libwayland has spelled an object id both ways: `wl_display@1`
# in the format every account of `WAYLAND_DEBUG` describes, `wl_display#1` in
# the one the engine on `crux` writes today.
DISPLAY_ON_THE_WIRE='wl_display[@#]1\.'
TOPLEVEL_ON_THE_WIRE='\.get_toplevel\('
MANAGER_ON_THE_WIRE='wl_registry[@#][0-9]+\.global\(.*zwp_keyboard_shortcuts_inhibit_manager_v1'
KEYBOARD_ON_THE_WIRE='\.get_keyboard\('
REQUEST_ON_THE_WIRE='\.inhibit_shortcuts\('

# The capture the readings are taken over: the engine's log with libwayland's
# colors taken out. See `normalized`.
CAPTURE="$(mktemp)"

# NOT THE PIDS A `&` HANDS BACK, WHICH ARE THE RIGHT ONES FOR NEITHER. The
# keyboard is `wtype` behind a `nix shell` wrapper and the engine is a browser
# with a zygote, a GPU process and renderers under it, so killing those two
# pids and returning left whatever was behind them running into the checks
# after this one, one of which times things. Everything started here carries
# `lib-compositor-cleanup.sh`'s marker naming this guard, and all of it is gone
# before this returns. That library calls anything it marks a compositor.
cleanup() {
  kill_compositors "$(compositor_owner)"
  wait
  rm -f "$CAPTURE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shortcuts-inhibitor: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
# The nested session this is a client of. `under-wayland.sh` exports it, and
# without one the engine would fall back to another platform entirely and this
# would measure a browser that never spoke Wayland.
[ -n "${WAYLAND_DISPLAY:-}" ] || {
  annotate "guard-shortcuts-inhibitor: no WAYLAND_DISPLAY; run this under packages/domicile-engine/scripts/under-wayland.sh"
  exit 1
}

# `wtype` lives in nixpkgs rather than in either dev shell, and is fetched the
# way `under-wayland.sh` fetches sway and `guard-shell.sh` fetches kitty.
if command -v wtype >/dev/null; then
  WTYPE=(wtype)
elif command -v nix >/dev/null; then
  WTYPE=(nix shell nixpkgs#wtype --command wtype)
else
  WTYPE=()
fi

rm -f "$BROKER"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

# A capture with libwayland's colors taken out.
#
# WITHOUT THIS THE PATTERNS ABOVE CANNOT MATCH, and the cost of finding that out
# was a whole run on `crux`. The dump the engine writes today puts an escape
# sequence between every token of a message —
# `wl_display<ESC>[35m#1<ESC>[36m.delete_id` — so `wl_display#1.delete_id` is
# not in the file as a string at all, however the object id is spelled. Taken
# out, both of libwayland's shapes are the same line of text, and the
# diagnostics below are readable by whoever opens the job rather than a smear of
# escapes.
normalized() { # $1 a capture
  sed "s/$(printf '\033')\[[0-9;]*[a-zA-Z]//g" "$1"
}

# Waits for `$2` to appear in `$3`, for `$1` seconds, reading it the way the
# readings do. A second rather than a quarter of one because each pass is a
# `sed` over a growing capture, and this is a wait for a window to map.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    normalized "$3" 2>/dev/null | grep -aqE -- "$2" && return 0
    sleep 1
  done
  return 1
}

# 1. A keyboard on the host's seat, before the engine is started rather than
#    beside it: the request is made once, where the toplevel is set up, and a
#    capability that arrives after that is a capability the engine has already
#    decided without.
#
#    NOT FATAL ON ITS OWN, AND DELIBERATELY. A host that is somebody's real
#    session — which `under-wayland.sh` uses as-is when it finds one — has a
#    keyboard already and may carry no virtual-keyboard protocol at all, and a
#    guard that stopped here would refuse to run in the one configuration a
#    person has in front of them. What the seat ended up with is read off the
#    wire below, which is the only end that decides anything; this says loudly
#    that it did not come up, and the verdict names it.
#    ONE THAT ENDS FIRST, AND THEN THE ONE THAT STAYS. `wtype` creates the
#    keyboard, uploads a keymap and then runs what it was asked for, so a run
#    of it that exits zero has done the whole of that — and the one-millisecond
#    sleep below is a synchronous answer to "can a keyboard be made on this
#    host", which nothing else here can ask. It also pays the fetch: a `nix
#    shell` on a cold machine spends its first seconds on the binary cache, and
#    a keyboard that appears after the window is mapped is a keyboard the
#    engine has already decided without.
: >"$KEYBOARD_LOG"
if [ ${#WTYPE[@]} -eq 0 ]; then
  echo "no wtype and no nix to fetch one, so this run has whatever keyboard the host already had" >&2
elif ! "${WTYPE[@]}" -k Shift_L -s 1 >"$KEYBOARD_LOG" 2>&1; then
  echo "no virtual keyboard could be made on $WAYLAND_DISPLAY. wtype said:" >&2
  tail -5 "$KEYBOARD_LOG" >&2
else
  env "$(compositor_env)" \
    "${WTYPE[@]}" -k Shift_L -s "$KEYBOARD_LIVES_FOR_MS" >>"$KEYBOARD_LOG" 2>&1 &
  sleep 1
  echo "a virtual keyboard is on the host's seat"
fi

# 2. The engine, nested, on a domicile:// document — the configuration a
#    desktop runs in, which is the only one where the switch below is passed.
#    `--app` for the reason every guard here repeats it: a tab strip above the
#    shell is the difference between a desktop and a browser looking at a page.
#
#    `WAYLAND_DEBUG=1` is the whole instrument. It is set on the engine and
#    nothing else, so the capture is this browser's own conversation with the
#    host.
#
#    THE SWITCH IS THE ONE THING THE CONTROL CHANGES. `domicile-launch` passes
#    it on the wayland platform and nowhere else, and this guard passes it by
#    hand for the same reason it exists: a guard that runs `chrome
#    --ozone-platform=wayland` is not a desktop, and the engine does not infer
#    this from its platform.
if [ "$NEGATIVE" = "1" ]; then
  SWITCH=()
  echo "starting the engine WITHOUT --domicile-inhibit-host-shortcuts"
else
  SWITCH=(--domicile-inhibit-host-shortcuts)
  echo "starting the engine with --domicile-inhibit-host-shortcuts"
fi
env "$(compositor_env)" WAYLAND_DEBUG=1 "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --app=domicile://shell/ \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shortcuts-inhibitor.js" \
  "${SWITCH[@]}" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &

# 3. The window, which is where the request is made. Not fatal here either —
#    the verdict says what a run without one measured, and says it once.
wait_for_line "$FOR_SECONDS" "$TOPLEVEL_ON_THE_WIRE" "$ENGINE_LOG" ||
  echo "no toplevel was ever made on $WAYLAND_DISPLAY" >&2

sleep "$SETTLE_SECONDS"

# THE READINGS, in the order the header lists them, over one normalization of
# the capture rather than five. `-a`, because a capture with a binary chunk in it
# is a capture grep would otherwise refuse to read.
normalized "$ENGINE_LOG" >"$CAPTURE" 2>/dev/null
SAW_WIRE=$(grep -aqE -- "$DISPLAY_ON_THE_WIRE" "$CAPTURE" && echo 1 || echo 0)
SAW_TOPLEVEL=$(grep -aqE -- "$TOPLEVEL_ON_THE_WIRE" "$CAPTURE" &&
                 echo 1 || echo 0)
SAW_MANAGER=$(grep -aqE -- "$MANAGER_ON_THE_WIRE" "$CAPTURE" &&
                echo 1 || echo 0)
SAW_KEYBOARD=$(grep -aqE -- "$KEYBOARD_ON_THE_WIRE" "$CAPTURE" &&
                 echo 1 || echo 0)
ASKED=$(grep -aqE -- "$REQUEST_ON_THE_WIRE" "$CAPTURE" && echo 1 || echo 0)

echo
echo "wire=$SAW_WIRE toplevel=$SAW_TOPLEVEL manager=$SAW_MANAGER keyboard=$SAW_KEYBOARD asked=$ASKED"
echo

# WHICH END TO BLAME, and it is the whole of this script's judgment. Five
# readings and two modes make more answers than a person reading an annotation
# can be expected to reconstruct, and the failure that matters most — a capture
# that is not a wire dump — looks from a grep's side exactly like the one the
# guard exists to report. So they are decided here, in a block
# `scripts/test-shortcuts-inhibitor-guard.sh` runs directly, rather than
# inferred from a grep by whoever opens the job.
FAILURE=""
PASSED=""
if [ "$SAW_WIRE" != "1" ]; then
  FAILURE="the engine's log carries no message on the display object — no \
\`wl_display@1.\` and no \`wl_display#1.\`, and every Wayland client's \
connection is full of them. So every reading below it is a grep over a file \
nothing wrote the answer to, and this run measured NOTHING; it is not a report \
that the engine did not ask. Three ways: WAYLAND_DEBUG=1 not reaching the \
engine, an engine that never connected to the host's display, and a libwayland \
whose dump is shaped like neither of those spellings — the first lines of the \
capture, printed below, are what says which"
elif [ "$SAW_TOPLEVEL" != "1" ]; then
  FAILURE="no xdg toplevel was ever made, so the engine never reached \
SetUpShellIntegration() and there was no call site for the request. Nothing \
was measured. That is the window: the browser's own log says how far it got"
elif [ "$SAW_MANAGER" != "1" ]; then
  FAILURE="the host compositor never offered \
zwp_keyboard_shortcuts_inhibit_manager_v1, so there was nothing for the engine \
to ask. That is the compositor this ran under rather than the engine — \
under-wayland.sh's sway carries the protocol, a session that was already \
running may not"
elif [ "$SAW_KEYBOARD" != "1" ]; then
  FAILURE="the host's seat announced no keyboard — no wl_seat.get_keyboard on \
the wire — so the engine took its 'no keyboard on the seat' arm and asked for \
nothing. Under under-wayland.sh the seat has a keyboard only while this \
guard's virtual one is on it, and the keyboard log beside this run's engine log \
says whether it came up. Not a verdict on the switch"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$ASKED" = "1" ]; then
    FAILURE="the control ran WITHOUT --domicile-inhibit-host-shortcuts and \
inhibit_shortcuts crossed the wire anyway. Either the switch is not what \
decides this — the fork's claim is that it is, and that a guard nested in \
somebody's session must not swallow their keymap — or the grep is matching \
something other than this request, in which case the positive run's pass is \
not about the switch at all"
  else
    PASSED="without the switch the request is absent, over a run that \
reached the same window, the same host protocol and the same keyboard — so the \
positive run's inhibit_shortcuts is the switch's doing and not something every \
nested chrome does"
  fi
elif [ "$ASKED" != "1" ]; then
  FAILURE="--domicile-inhibit-host-shortcuts was passed, a window was mapped \
on a host that carries the protocol, the seat had a keyboard, and no \
inhibit_shortcuts crossed the wire. So a nested desktop is leaving the host's \
bindings in place and every Meta chord a shell claims will be taken by the \
compositor instead. Patch 0038 is what asks; the browser's own log carries the \
two ways it says it could not"
else
  PASSED="the engine asked the host compositor for \
zwp_keyboard_shortcuts_inhibitor_v1 over its window's surface. That the \
request was MADE — not that a key was pressed, nor that the host honored it"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

# THE ENGINE'S OWN WORDS FIRST, AND KEPT APART FROM THE WIRE'S. Patch 0038 logs
# the two ways it can decline, and both are one line in a file where every other
# line has the words `seat` and `shortcuts` in it — a single grep over both would
# tail twenty wire messages and bury the sentence that explains the run.
annotate "guard-shortcuts-inhibitor: $FAILURE"
echo "what the engine said about the inhibitor:" >&2
grep -aE 'domicile:|ERROR' "$CAPTURE" | tail -10 | cut -c1-200 |
  sed 's/^/  /' >&2
echo "what the wire said about the seat and the protocol:" >&2
grep -aE 'wl_seat[@#]|shortcuts_inhibit' "$CAPTURE" | tail -10 | cut -c1-200 |
  sed 's/^/  /' >&2
# BOTH ENDS OF THE CAPTURE, and the first end is the one a wrongly-shaped
# pattern is diagnosed from: a connection's first messages are at the top, and a
# run that printed only the tail left the next reader guessing at what the dump
# looks like. Ten lines of it answers that outright.
echo "the first of the capture, which is what its shape looks like:" >&2
head -10 "$CAPTURE" | cut -c1-200 | sed 's/^/  /' >&2
echo "the last of it:" >&2
tail -10 "$CAPTURE" | cut -c1-200 | sed 's/^/  /' >&2
echo "what the virtual keyboard said ($KEYBOARD_LOG):" >&2
tail -5 "$KEYBOARD_LOG" | sed 's/^/  /' >&2
exit 1
