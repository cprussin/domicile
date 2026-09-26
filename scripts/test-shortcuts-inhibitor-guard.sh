#!/usr/bin/env bash
# Which end the shortcuts-inhibitor guard blames, and what it refuses to call
# a measurement.
#
# The unit is the verdict block in `guard-shortcuts-inhibitor.sh` — the `if`
# chain that turns five readings off a `WAYLAND_DEBUG` capture and the run's
# mode into either a pass or one sentence naming an end. It is worth a test of
# its own because THE GUARD'S ONLY INSTRUMENT IS A GREP, and a grep over a file
# that is empty, truncated or never written answers "not there" in exactly the
# same voice it uses for a request the engine genuinely did not make. A run
# where `WAYLAND_DEBUG=1` never reached the engine would then read as the
# positive run's failure and — worse — as the control's pass, which is a
# control establishing nothing about a guard that is measuring nothing.
#
# So the order of the gates is the whole of what separates those, and an
# ordered chain is a thing that can be got wrong in a way no working engine
# would ever reveal:
#
#   a capture that is not a wire dump is never read as "the engine did not ask"
#   a run with no window in it measured nothing, in either mode, because the
#     request is made where the toplevel is set up
#   the control's gates are the run's, because its setup is the run's with one
#     switch taken off
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shortcuts-inhibitor.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, so this cannot half-match: the nested `fi` in the
# control's arm is indented, and the block stops before the `if [ -n "$PASSED" ]`
# below it — a verdict is a value here, not a status.
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# A run in which everything the guard wants is true; each case below changes
# one reading. Written as a baseline plus overrides rather than five positional
# arguments, because a case that says `SAW_WIRE=0` says what it is testing and
# a case that says `0 1 1 1 1` does not.
readings() { # $1 NEGATIVE, then NAME=value overrides
  SAW_WIRE=1
  SAW_TOPLEVEL=1
  SAW_MANAGER=1
  SAW_KEYBOARD=1
  ASKED=1
  NEGATIVE="$1"
  shift
  for override in "$@"; do
    eval "$override"
  done
}

verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    readings "$@"
    eval "$BLOCK"
    if [ -n "$PASSED" ]; then
      echo "pass"
    elif [ -n "$FAILURE" ]; then
      echo "fail"
    else
      echo "neither"
    fi
  )
}

# The failing sentence, for the cases where WHICH end it names is the point. Not
# the whole wording: sentences are prose and will be reworded, and a test that
# pinned them would fail for edits that changed no behavior.
reason() { # $1 NEGATIVE, then NAME=value overrides
  (
    readings "$@"
    eval "$BLOCK"
    echo "$FAILURE"
  )
}

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(reason "$@")" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a capture that is not a wire dump is not a measurement"
# THE VACUITY THIS GUARD IS MOST EXPOSED TO. Every reading below it is a grep,
# and a grep over a file libwayland never wrote to answers "no" to all of them.
# Read in the obvious order, that is a positive run reporting the one failure
# it exists to report — about an engine that may well have asked.
expect "no wire is a failure" "fail" "$(verdict 0 SAW_WIRE=0)"
expect "no wire names WAYLAND_DEBUG" "yes" "$(blames "WAYLAND_DEBUG" 0 SAW_WIRE=0)"
expect "an empty capture is not read as a request that was not made" "yes" \
  "$(blames "WAYLAND_DEBUG" 0 SAW_WIRE=0 SAW_TOPLEVEL=0 SAW_MANAGER=0 \
       SAW_KEYBOARD=0 ASKED=0)"
# AND IN THE CONTROL, which is the arm a verdict written as "the control passes
# when the request is absent" gets wrong: an absence over a capture nobody
# wrote is the cheapest pass there is.
expect "no wire is a failure in the control too" "fail" \
  "$(verdict 1 SAW_WIRE=0 ASKED=0)"

echo
echo "a run with nothing in it to ask"
# The request is made in SetUpShellIntegration, which runs when the toplevel
# does. No toplevel, no call site — and both modes are then reading an absence
# that says nothing about the switch.
expect "no toplevel is a failure" "fail" "$(verdict 0 SAW_TOPLEVEL=0)"
expect "no toplevel names the window" "yes" \
  "$(blames "toplevel" 0 SAW_TOPLEVEL=0)"
expect "no toplevel is a failure in the control too" "fail" \
  "$(verdict 1 SAW_TOPLEVEL=0 ASKED=0)"
# The two facts about the HOST, which the engine's own code reads before it
# asks for anything: a compositor that does not carry the protocol, and a seat
# that announced no keyboard. Under `under-wayland.sh` the second is the one
# that moves — sway advertises the capability only while an input device backs
# it, and this guard's is a virtual keyboard it starts itself.
expect "a host with no manager is a failure" "fail" "$(verdict 0 SAW_MANAGER=0)"
expect "a host with no manager names the protocol" "yes" \
  "$(blames "zwp_keyboard_shortcuts_inhibit_manager_v1" 0 SAW_MANAGER=0)"
expect "a seat with no keyboard is a failure" "fail" "$(verdict 0 SAW_KEYBOARD=0)"
expect "a seat with no keyboard names the keyboard" "yes" \
  "$(blames "keyboard" 0 SAW_KEYBOARD=0)"
expect "a seat with no keyboard is a failure in the control too" "fail" \
  "$(verdict 1 SAW_KEYBOARD=0 ASKED=0)"

echo
echo "the run — the request on the wire, and nothing more than that"
expect "the request on the wire is the pass" "pass" "$(verdict 0)"
expect "no request is the failure" "fail" "$(verdict 0 ASKED=0)"
expect "no request names the request" "yes" \
  "$(blames "inhibit_shortcuts" 0 ASKED=0)"

echo
echo "the control — the same run without the switch, where the request must be absent"
expect "no request without the switch is the pass" "pass" "$(verdict 1 ASKED=0)"
expect "a request without the switch is a failure" "fail" "$(verdict 1)"
expect "a request without the switch names the switch" "yes" \
  "$(blames "domicile-inhibit-host-shortcuts" 1)"

echo
echo "what the greps match, against the shape libwayland writes"
# THE OTHER HALF OF THE GUARD, and the half the verdict block above takes on
# trust. Five patterns turn a capture into the five readings, and a pattern
# that matches nothing produces the same zero as a request that was never sent
# — which is the vacuity this whole guard is built against, one layer below
# where the block can see it.
#
# AND THE SHAPE IS NOT ONE SHAPE, WHICH COST THIS GUARD ITS FIRST RUN. libwayland
# used to write `[3223290.760] -> wl_display@1.get_registry(new id wl_registry@2)`
# and now writes the same message as
# `[21:39:43.452307] {Display Queue} <ESC>[34mwl_display<ESC>[35m#1<ESC>[36m.delete_id<ESC>[0m(41)`
# — a clock rather than a stopwatch, the queue it came off, `#` for `@`, and a
# color around every token. Engine run 36189695475 met the second and the guard's
# first gate read `wire=0`: it refused to report anything about the request,
# correctly, because it could not read the capture at all. Both shapes are
# fixtures here, and the colored one goes through `normalized` exactly as the
# guard puts it.
PATTERNS="$(grep -E "^[A-Z_]+_ON_THE_WIRE='" "$GUARD")"
FOUND="$(echo "$PATTERNS" | grep -c .)"
[ "$FOUND" -eq 5 ] || {
  echo "  FAIL  the guard's five patterns were read at all" >&2
  echo "    found $FOUND assignments matching ^[A-Z_]+_ON_THE_WIRE= in $GUARD" >&2
  exit 1
}
eval "$PATTERNS"

# The guard's own normalization, run out of the guard for the reason the verdict
# block is: a copy here would go on passing against a version nobody ships.
NORMALIZE="$(awk '/^normalized\(\) \{/,/^\}/' "$GUARD")"
[ -n "$NORMALIZE" ] || {
  echo "  FAIL  the guard's normalization was read at all" >&2
  echo "    no normalized() in $GUARD — it moved. Fix this test with it." >&2
  exit 1
}
eval "$NORMALIZE"

# Every reading the guard takes, taken the way it takes it: the line into a file,
# the file through `normalized`, the pattern over what comes out.
matches() { # $1 pattern, $2 line
  local file
  file="$(mktemp)"
  printf '%s\n' "$2" >"$file"
  if normalized "$file" | grep -qE -- "$1"; then echo yes; else echo no; fi
  rm -f "$file"
}

# One ANSI escape, so the fixtures below read as the log does rather than as a
# wall of `\033`.
E="$(printf '\033')"

REGISTRY_LINE='[3223290.760] -> wl_display@1.get_registry(new id wl_registry@2)'
GLOBAL_LINE='[3223290.799] wl_registry@2.global(31, "zwp_keyboard_shortcuts_inhibit_manager_v1", 1)'
BIND_LINE='[3223290.801] -> wl_registry@2.bind(31, "zwp_keyboard_shortcuts_inhibit_manager_v1", 1, new id [unknown]@23)'
KEYBOARD_LINE='[3223291.004] -> wl_seat@14.get_keyboard(new id wl_keyboard@21)'
TOPLEVEL_LINE='[3223291.120] -> xdg_surface@33.get_toplevel(new id xdg_toplevel@34)'
REQUEST_LINE='[3223291.311] -> zwp_keyboard_shortcuts_inhibit_manager_v1@23.inhibit_shortcuts(new id zwp_keyboard_shortcuts_inhibitor_v1@41, wl_surface@30, wl_seat@14)'
ACTIVE_LINE='[3223291.500] zwp_keyboard_shortcuts_inhibitor_v1@41.active()'
# The engine's own words, in the same file as the wire, because
# `--enable-logging=stderr` and WAYLAND_DEBUG write to one stream. Patch 0038
# names the protocol in the line it logs when the host has NOT got it — so a
# pattern that reads the interface name anywhere reads a missing manager as a
# present one, and the control then passes over a host that could not have
# answered the request at all.
ENGINE_ERROR_LINE='[1234/5678:ERROR:wayland_toplevel_window.cc(1102)] domicile: the host compositor offers no zwp_keyboard_shortcuts_inhibit_manager_v1, so it keeps its shortcuts and the shell'"'"'s Meta bindings will not arrive'

# THE SHAPE THE ENGINE ON `crux` ACTUALLY WRITES. The delete_id line is verbatim
# from engine run 36189695475; the rest are the same message shape with the
# fields that message has. The empty red segment before the interface is where
# libwayland puts ` -> ` on a request and `discarded ` on a dropped event, and
# none of the patterns lean on it: `get_registry`, `get_toplevel`,
# `get_keyboard` and `inhibit_shortcuts` are REQUEST names in their protocols
# and there is no event by any of those names to confuse them with.
COLORED_DISPLAY_LINE="$E[32m[21:39:43.452307] $E[33m{Display Queue} $E[31m$E[0m$E[34mwl_display$E[35m#1$E[36m.delete_id$E[0m(41)$E[0m"
COLORED_GLOBAL_LINE="$E[32m[21:39:43.001234] $E[33m{Display Queue} $E[31m$E[0m$E[34mwl_registry$E[35m#2$E[36m.global$E[0m(31, \"zwp_keyboard_shortcuts_inhibit_manager_v1\", 1)$E[0m"
COLORED_KEYBOARD_LINE="$E[32m[21:39:43.101112] $E[33m{Default Queue} $E[31m -> $E[0m$E[34mwl_seat$E[35m#14$E[36m.get_keyboard$E[0m(new id wl_keyboard#21)$E[0m"
COLORED_TOPLEVEL_LINE="$E[32m[21:39:43.202122] $E[33m{Default Queue} $E[31m -> $E[0m$E[34mxdg_surface$E[35m#33$E[36m.get_toplevel$E[0m(new id xdg_toplevel#34)$E[0m"
COLORED_REQUEST_LINE="$E[32m[21:39:43.303132] $E[33m{Default Queue} $E[31m -> $E[0m$E[34mzwp_keyboard_shortcuts_inhibit_manager_v1$E[35m#23$E[36m.inhibit_shortcuts$E[0m(new id zwp_keyboard_shortcuts_inhibitor_v1#41, wl_surface#30, wl_seat#14)$E[0m"
COLORED_ACTIVE_LINE="$E[32m[21:39:43.404142] $E[33m{Display Queue} $E[31m$E[0m$E[34mzwp_keyboard_shortcuts_inhibitor_v1$E[35m#41$E[36m.active$E[0m()$E[0m"

expect "a message on the display object is what says this is a wire dump" "yes" \
  "$(matches "$DISPLAY_ON_THE_WIRE" "$COLORED_DISPLAY_LINE")"
expect "the manager is read off the registry the host sent" "yes" \
  "$(matches "$MANAGER_ON_THE_WIRE" "$COLORED_GLOBAL_LINE")"
expect "the seat's keyboard is read off the request for one" "yes" \
  "$(matches "$KEYBOARD_ON_THE_WIRE" "$COLORED_KEYBOARD_LINE")"
expect "the toplevel is read off get_toplevel" "yes" \
  "$(matches "$TOPLEVEL_ON_THE_WIRE" "$COLORED_TOPLEVEL_LINE")"
expect "the request is read off inhibit_shortcuts" "yes" \
  "$(matches "$REQUEST_ON_THE_WIRE" "$COLORED_REQUEST_LINE")"
expect "the inhibitor's own event is not the request, colored either" "no" \
  "$(matches "$REQUEST_ON_THE_WIRE" "$COLORED_ACTIVE_LINE")"

# AND THE OLDER SHAPE, which is what a host with an older libwayland writes and
# what every account of `WAYLAND_DEBUG` describes. The guard reads a capture, not
# a version, so both have to answer.
expect "the older dump is a dump too" "yes" \
  "$(matches "$DISPLAY_ON_THE_WIRE" "$REGISTRY_LINE")"
expect "the manager is read off the older registry event too" "yes" \
  "$(matches "$MANAGER_ON_THE_WIRE" "$GLOBAL_LINE")"
expect "the older request for a keyboard reads the same" "yes" \
  "$(matches "$KEYBOARD_ON_THE_WIRE" "$KEYBOARD_LINE")"
expect "the older get_toplevel reads the same" "yes" \
  "$(matches "$TOPLEVEL_ON_THE_WIRE" "$TOPLEVEL_LINE")"
expect "the older inhibit_shortcuts reads the same" "yes" \
  "$(matches "$REQUEST_ON_THE_WIRE" "$REQUEST_LINE")"
# WHAT THE CLAIM MUST NOT BE SATISFIED BY. Binding the manager is what every
# nested chrome does at startup, whatever the switch says, and the inhibitor's
# own `active` event comes back from the COMPOSITOR — reading either as "the
# engine asked" would make the control unfailable and the run's pass a
# statement about the protocol being present rather than about the request.
expect "binding the manager is not the request" "no" \
  "$(matches "$REQUEST_ON_THE_WIRE" "$BIND_LINE")"
expect "the manager in the registry is not the request" "no" \
  "$(matches "$REQUEST_ON_THE_WIRE" "$GLOBAL_LINE")"
expect "an event back from the compositor is not the request" "no" \
  "$(matches "$REQUEST_ON_THE_WIRE" "$ACTIVE_LINE")"
expect "the engine saying the host has no manager is not the host having one" "no" \
  "$(matches "$MANAGER_ON_THE_WIRE" "$ENGINE_ERROR_LINE")"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the shortcuts-inhibitor guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
