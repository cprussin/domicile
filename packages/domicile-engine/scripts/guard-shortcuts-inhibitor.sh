#!/usr/bin/env bash
# Checks that the engine asks the host compositor to inhibit its shortcuts.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-shortcuts-inhibitor.sh /build/chromium/src
#
# Proves one thing: the engine sent
# `zwp_keyboard_shortcuts_inhibit_manager_v1.inhibit_shortcuts` for the
# desktop window's surface. It does not prove a key was pressed, that the host
# honored the request, or that a Meta chord reached the page;
# `guard-shortcuts-inhibitor-chord.sh` checks that.
#
# Patch `0038` makes a shell's Meta chords reach a nested desktop. If it breaks,
# the host keeps its bindings and nothing logs an error. This catches the patch
# not applying, the switch not being read, or the call moving out of
# `SetUpShellIntegration()`.
#
# The request is visible only on the wire, so the guard reads libwayland's
# `WAYLAND_DEBUG` dump, e.g.
# `zwp_keyboard_shortcuts_inhibit_manager_v1#23.inhibit_shortcuts(new id
# zwp_keyboard_shortcuts_inhibitor_v1#41, wl_surface#30, wl_seat#14)`. The dump
# format varies by libwayland version; `normalized` and the patterns handle it.
#
# The engine only requests an inhibitor if the seat has a keyboard
# (`WaylandKeyboard::CreateShortcutsInhibitor`), and sway advertises one only
# while an input device exists. `under-wayland.sh` runs headless with
# `WLR_LIBINPUT_NO_DEVICES=1`, so `wtype` adds a `zwp_virtual_keyboard_v1`
# and holds it open for the whole run. The request is made once, at toplevel
# setup, so the keyboard must exist first.
#
# `-k Shift_L` only gives wtype a non-empty keymap to upload. It is pressed
# before the engine starts and nothing reads where it went.
#
# Readings, all from the engine's `WAYLAND_DEBUG` capture, each meaningful only
# if the ones above it hold:
#
#   a wire dump at all             otherwise every grep reads "no"
#   a toplevel was made            the request is made at toplevel setup
#   the host carries the protocol  `zwp_keyboard_shortcuts_inhibit_manager_v1`
#                                  in the registry
#   the seat announced a keyboard  `wl_seat.get_keyboard`, sent only once the
#                                  seat has the keyboard capability
#   `inhibit_shortcuts` was sent   the claim
#
# `NEGATIVE=1` omits `--domicile-inhibit-host-shortcuts`; the request must
# then be absent. This shows the switch causes it (see
# `packages/domicile-launch/src/spawn.rs` and patch `0038`'s header). The
# control requires the same four setup readings.
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

# NEGATIVE=1 runs without the switch. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-shortcuts-inhibitor-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shortcuts-inhibitor-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# How long the engine gets to map a toplevel. Generous for cold starts; the
# poll ends as soon as the line appears.
FOR_SECONDS="${FOR_SECONDS:-90}"

# How long to wait after the toplevel before reading the capture. The request
# is sent during toplevel setup, so the run needs little time, but the control
# looks for an absence and must wait. Both runs pay this once, so it does not
# use `lib-control-budget.sh`.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

# Longer than the run: the seat's keyboard capability goes when the keyboard
# does. `cleanup` ends it; this only covers a guard killed outright.
KEYBOARD_LIVES_FOR_MS="${KEYBOARD_LIVES_FOR_MS:-300000}"

# A run and its control write separate logs so both can be read side by side.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shortcuts-inhibitor$WHICH-engine.log}"
KEYBOARD_LOG="${KEYBOARD_LOG:-/tmp/domicile-shortcuts-inhibitor$WHICH-keyboard.log}"

# Each reading's pattern, kept separate so
# `scripts/test-shortcuts-inhibitor-guard.sh` can test them against both dump
# formats libwayland has used.
#
# Patterns match request names, not the ` -> ` direction marker, whose spelling
# has changed. `get_registry`, `get_toplevel`, `get_keyboard` and
# `inhibit_shortcuts` are request names no event shares.
#
# The claim includes the dot: binding the manager happens regardless of the
# switch, and `zwp_keyboard_shortcuts_inhibitor_v1.active` is an event.
#
# The manager is matched as a registry event because patch `0038`'s "host lacks
# the protocol" log line names the protocol, and must not count as present.
#
# `[@#]`: libwayland has written object ids both ways (`wl_display@1`,
# `wl_display#1`).
DISPLAY_ON_THE_WIRE='wl_display[@#]1\.'
TOPLEVEL_ON_THE_WIRE='\.get_toplevel\('
MANAGER_ON_THE_WIRE='wl_registry[@#][0-9]+\.global\(.*zwp_keyboard_shortcuts_inhibit_manager_v1'
KEYBOARD_ON_THE_WIRE='\.get_keyboard\('
REQUEST_ON_THE_WIRE='\.inhibit_shortcuts\('

# The engine's log with libwayland's colors stripped. See `normalized`.
CAPTURE="$(mktemp)"

# Kill everything this starts before returning. The keyboard (`wtype` behind
# `nix shell`) and the browser both fork, so the `&` pids are not the live ones
# and leftovers would disturb later timed checks. Everything carries
# `lib-compositor-cleanup.sh`'s marker; `kill_compositors` kills everything
# with it, not only compositors.
cleanup() {
  kill_compositors "$(compositor_owner)"
  wait
  rm -f "$CAPTURE"
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shortcuts-inhibitor: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
# Without a Wayland session the engine would use another platform and never
# speak Wayland. `under-wayland.sh` exports one.
[ -n "${WAYLAND_DISPLAY:-}" ] || {
  annotate "guard-shortcuts-inhibitor: no WAYLAND_DISPLAY; run this under packages/domicile-engine/scripts/under-wayland.sh"
  exit 1
}

# `wtype` comes from nixpkgs, like sway in `under-wayland.sh`.
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

# A capture with libwayland's color escapes stripped.
#
# The dump puts an escape between tokens, e.g.
# `wl_display<ESC>[35m#1<ESC>[36m.delete_id`, so the patterns cannot match
# without this.
normalized() { # $1 a capture
  sed "s/$(printf '\033')\[[0-9;]*[a-zA-Z]//g" "$1"
}

# Waits up to `$1` seconds for `$2` in `$3`, read as the readings are. Polls
# each second, since each pass runs `sed` over the whole capture.
wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    normalized "$3" 2>/dev/null | grep -aqE -- "$2" && return 0
    sleep 1
  done
  return 1
}

# 1. Put a keyboard on the host seat before starting the engine: the request
#    is made once, at toplevel setup.
#
#    Not fatal: a real session (which `under-wayland.sh` uses if present)
#    already has a keyboard and may lack the virtual-keyboard protocol. The
#    wire readings decide; the verdict names a missing keyboard.
#
#    The first wtype run exits after 1ms and checks a keyboard can be made. It
#    also pays any cold `nix shell` fetch before the engine starts. The second
#    stays up for the run.
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

# 2. The engine, nested, on a domicile:// document as in a desktop. `--app`
#    avoids a tab strip above the shell.
#
#    `WAYLAND_DEBUG=1` is set on the engine only, so the capture is its own
#    conversation with the host.
#
#    The switch is the only thing the control changes. `domicile-launch`
#    passes it on Wayland; the engine does not infer it from the platform.
if [ "$NEGATIVE" = "1" ]; then
  SWITCH=()
  echo "starting the engine WITHOUT --domicile-inhibit-host-shortcuts"
else
  SWITCH=(--domicile-inhibit-host-shortcuts)
  echo "starting the engine with --domicile-inhibit-host-shortcuts"
fi
rm -f "$ENGINE_LOG"
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

# 3. Wait for the window, where the request is made. Not fatal; the verdict
#    reports it.
wait_for_line "$FOR_SECONDS" "$TOPLEVEL_ON_THE_WIRE" "$ENGINE_LOG" ||
  echo "no toplevel was ever made on $WAYLAND_DISPLAY" >&2

sleep "$SETTLE_SECONDS"

# The readings, in header order, over one normalized capture. `-a` because
# grep would otherwise refuse a capture containing binary data.
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

# The verdict. `scripts/test-shortcuts-inhibitor-guard.sh` runs this block
# directly. A capture that is not a wire dump looks like a missing request to
# grep, so the setup readings are checked first.
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

# Print the engine's own decline messages (patch 0038) separately; mixed with
# the wire lines they would be buried.
annotate "guard-shortcuts-inhibitor: $FAILURE"
echo "what the engine said about the inhibitor:" >&2
grep -aE 'domicile:|ERROR' "$CAPTURE" | tail -10 | cut -c1-200 |
  sed 's/^/  /' >&2
echo "what the wire said about the seat and the protocol:" >&2
grep -aE 'wl_seat[@#]|shortcuts_inhibit' "$CAPTURE" | tail -10 | cut -c1-200 |
  sed 's/^/  /' >&2
# Print the head of the capture too: it shows the dump's format when a pattern
# fails to match.
echo "the first of the capture, which is what its shape looks like:" >&2
head -10 "$CAPTURE" | cut -c1-200 | sed 's/^/  /' >&2
echo "the last of it:" >&2
tail -10 "$CAPTURE" | cut -c1-200 | sed 's/^/  /' >&2
echo "what the virtual keyboard said ($KEYBOARD_LOG):" >&2
tail -5 "$KEYBOARD_LOG" | sed 's/^/  /' >&2
exit 1
