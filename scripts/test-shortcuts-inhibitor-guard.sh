#!/usr/bin/env bash
# Tests which side `guard-shortcuts-inhibitor.sh` blames, and what it refuses
# to count as a measurement.
#
# The guard greps a `WAYLAND_DEBUG` capture. A grep over an empty or missing
# capture reports "not there", the same as a request the engine did not make.
# That would fail the positive run and pass the control without measuring
# anything. The order of the gates prevents this:
#
#   - a capture that is not a wire dump never reads as "the engine did not ask"
#   - a run with no window measured nothing in either mode, since the request
#     is made when the toplevel is set up
#   - the control uses the same gates, since its setup differs by one switch
#
# The block is read from the real script, so a moved block fails here.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shortcuts-inhibitor.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the closing `fi` at column zero. The nested `fi` is
# indented, and the block stops before the `if [ -n "$PASSED" ]` below it.
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

# A passing run; each case overrides one reading by name.
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

# The failure sentence, for cases that check which side it names. Match
# words, not the whole sentence, so rewording does not break the test.
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
# Every later reading is a grep, and a grep over an unwritten capture answers
# "no" to all of them, which would read as the engine not asking.
expect "no wire is a failure" "fail" "$(verdict 0 SAW_WIRE=0)"
expect "no wire names WAYLAND_DEBUG" "yes" "$(blames "WAYLAND_DEBUG" 0 SAW_WIRE=0)"
expect "an empty capture is not read as a request that was not made" "yes" \
  "$(blames "WAYLAND_DEBUG" 0 SAW_WIRE=0 SAW_TOPLEVEL=0 SAW_MANAGER=0 \
       SAW_KEYBOARD=0 ASKED=0)"
# In the control, an absence over an unwritten capture would otherwise pass.
expect "no wire is a failure in the control too" "fail" \
  "$(verdict 1 SAW_WIRE=0 ASKED=0)"

echo
echo "a run with nothing in it to ask"
# The request is made in SetUpShellIntegration, which runs with the toplevel.
# Without a toplevel, both modes read an absence that says nothing.
expect "no toplevel is a failure" "fail" "$(verdict 0 SAW_TOPLEVEL=0)"
expect "no toplevel names the window" "yes" \
  "$(blames "toplevel" 0 SAW_TOPLEVEL=0)"
expect "no toplevel is a failure in the control too" "fail" \
  "$(verdict 1 SAW_TOPLEVEL=0 ASKED=0)"
# The engine checks two host facts before asking: the compositor offers the
# protocol, and the seat has a keyboard. Under `under-wayland.sh`, sway
# advertises a keyboard only while an input device backs it, and the guard's
# is a virtual keyboard it starts itself.
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
# The patterns that turn a capture into readings. A pattern that matches
# nothing gives the same zero as an unsent request.
#
# libwayland writes two formats. Older versions write
# `[3223290.760] -> wl_display@1.get_registry(new id wl_registry@2)`. Newer
# versions write
# `[21:39:43.452307] {Display Queue} <ESC>[34mwl_display<ESC>[35m#1<ESC>[36m.delete_id<ESC>[0m(41)`
# with a wall-clock time, the queue name, `#` for `@`, and colors. Both are
# fixtures here, and colored lines go through the guard's `normalized`.
PATTERNS="$(grep -E "^[A-Z_]+_ON_THE_WIRE='" "$GUARD")"
FOUND="$(echo "$PATTERNS" | grep -c .)"
[ "$FOUND" -eq 5 ] || {
  echo "  FAIL  the guard's five patterns were read at all" >&2
  echo "    found $FOUND assignments matching ^[A-Z_]+_ON_THE_WIRE= in $GUARD" >&2
  exit 1
}
eval "$PATTERNS"

# The guard's own normalization, read from the guard.
NORMALIZE="$(awk '/^normalized\(\) \{/,/^\}/' "$GUARD")"
[ -n "$NORMALIZE" ] || {
  echo "  FAIL  the guard's normalization was read at all" >&2
  echo "    no normalized() in $GUARD — it moved. Fix this test with it." >&2
  exit 1
}
eval "$NORMALIZE"

# Each reading as the guard takes it: line to file, file through
# `normalized`, pattern over the output.
matches() { # $1 pattern, $2 line
  local file
  file="$(mktemp)"
  printf '%s\n' "$2" >"$file"
  if normalized "$file" | grep -qE -- "$1"; then echo yes; else echo no; fi
  rm -f "$file"
}

# One ANSI escape, so the fixtures read like the log.
E="$(printf '\033')"

REGISTRY_LINE='[3223290.760] -> wl_display@1.get_registry(new id wl_registry@2)'
GLOBAL_LINE='[3223290.799] wl_registry@2.global(31, "zwp_keyboard_shortcuts_inhibit_manager_v1", 1)'
BIND_LINE='[3223290.801] -> wl_registry@2.bind(31, "zwp_keyboard_shortcuts_inhibit_manager_v1", 1, new id [unknown]@23)'
KEYBOARD_LINE='[3223291.004] -> wl_seat@14.get_keyboard(new id wl_keyboard@21)'
TOPLEVEL_LINE='[3223291.120] -> xdg_surface@33.get_toplevel(new id xdg_toplevel@34)'
REQUEST_LINE='[3223291.311] -> zwp_keyboard_shortcuts_inhibit_manager_v1@23.inhibit_shortcuts(new id zwp_keyboard_shortcuts_inhibitor_v1@41, wl_surface@30, wl_seat@14)'
ACTIVE_LINE='[3223291.500] zwp_keyboard_shortcuts_inhibitor_v1@41.active()'
# Engine log lines share the stream with the wire dump. The engine logs the
# protocol name when the host lacks it, so a pattern matching the name
# anywhere would read a missing manager as present.
ENGINE_ERROR_LINE='[1234/5678:ERROR:wayland_toplevel_window.cc(1102)] domicile: the host compositor offers no zwp_keyboard_shortcuts_inhibit_manager_v1, so it keeps its shortcuts and the shell'"'"'s Meta bindings will not arrive'

# The colored format the engine on `crux` writes. The empty red segment is
# where libwayland puts ` -> ` on a request and `discarded ` on a dropped
# event; no pattern relies on it, since `get_registry`, `get_toplevel`,
# `get_keyboard` and `inhibit_shortcuts` are request names with no matching
# events.
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

# The older format must also match.
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
# Every nested chrome binds the manager at startup regardless of the switch,
# and `active` is an event from the compositor. Counting either as the
# request would make the control unable to fail.
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
