#!/usr/bin/env bash
# The engine's event interfaces and the SDK's types for them, compared.
#
# `navigator.domicile` fires five typed event interfaces. What they carry is
# declared twice: once in WebIDL, where Blink generates the bindings from it,
# and once in `@domicile/chrome-sdk`'s `domicile-host.ts`, where a shell reads
# it. Nothing makes the two agree, and neither half can notice on its own:
#
#   an attribute added to the IDL and not to the SDK is a value a shell cannot
#     see without casting -- which is the thing DATA.md forbids, arrived at by
#     the SDK being out of date rather than by anyone choosing it
#   a field in the SDK that no IDL declares is worse: it type-checks, it reads
#     `undefined` at runtime, and arithmetic on it is `NaN` rather than an error
#
# The second is not hypothetical. The SDK carried a `hop` window for a stage
# nothing ever recorded into, and the shell printed `ipc_ms=0` every interval
# for as long as it existed -- a measurement, to whoever read the log.
#
# Names only, not types. WebIDL's `DOMHighResTimeStamp` and TypeScript's
# `number` are the same thing said twice, and a script that tried to decide
# which spellings correspond would be a worse version of the compiler. What it
# can say for certain is that a field exists on both sides or on neither, which
# is the failure that actually happens.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDL_DIR="$ROOT/packages/domicile-engine/src/third_party/blink/renderer/modules/domicile"
SDK="$ROOT/packages/chrome-sdk/src/domicile-host.ts"
[ -d "$IDL_DIR" ] || { echo "no $IDL_DIR" >&2; exit 1; }
[ -f "$SDK" ] || { echo "no $SDK" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# `readonly attribute <type> <name>;` -- the last word before the semicolon,
# sorted, one per line. Nullability and array brackets ride on the type, which
# is not read here.
idl_attributes() {
  sed -n 's/^[[:space:]]*readonly attribute[[:space:]].*[[:space:]]\([A-Za-z0-9_]*\);.*/\1/p' \
    "$1" | sort -u
}

# The property names of one exported type in `domicile-host.ts`. The block runs
# from `export type <Name> = Event & {` to the `};` at column zero, which is how
# every type in that file is written; a property is `readonly <name>:` inside
# it.
sdk_fields() {
  awk -v name="$1" '
    $0 == "export type " name " = Event & {" { inside = 1; next }
    inside && /^};$/ { inside = 0 }
    inside' "$SDK" |
    sed -n 's/^[[:space:]]*readonly[[:space:]]\+\([A-Za-z0-9_]*\)[?]\?:.*/\1/p' |
    sort -u
}

# THE POSITIVE FIRST: a pair that matched nothing on both sides agrees
# vacuously, which is how a renamed file or a reformatted type declaration
# turns this into a green no-op. Both sides must be non-empty before their
# agreement means anything.
compare() { # interface, idl file
  local interface="$1" idl="$IDL_DIR/$2" declared read_back only_idl only_sdk
  [ -f "$idl" ] || { fail "$interface is declared in WebIDL" "no $idl"; return; }

  declared="$(idl_attributes "$idl")"
  read_back="$(sdk_fields "$interface")"

  if [ -z "$declared" ]; then
    fail "$interface has attributes to compare" \
      "no 'readonly attribute' lines in $2 -- its shape moved and this test reads nothing"
    return
  fi
  if [ -z "$read_back" ]; then
    fail "$interface has SDK fields to compare" \
      "no 'export type $interface = Event & {' block with readonly fields in domicile-host.ts"
    return
  fi

  # Comma separated and with no trailing space, because this string is read in
  # a sentence rather than by anything.
  only_idl="$(comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$read_back") | paste -sd, -)"
  only_sdk="$(comm -13 <(printf '%s\n' "$declared") <(printf '%s\n' "$read_back") | paste -sd, -)"

  if [ -n "$only_idl" ]; then
    fail "$interface carries the same fields on both sides" \
      "the engine declares $only_idl and the SDK does not, so a shell cannot read it without a cast"
  elif [ -n "$only_sdk" ]; then
    fail "$interface carries the same fields on both sides" \
      "the SDK declares $only_sdk and no IDL does, so it type-checks and reads undefined"
  else
    ok "$interface carries the same fields on both sides"
  fi
}

compare DomicileAppEvent domicile_app_event.idl
compare DomicileAppCursorEvent domicile_app_cursor_event.idl
compare DomicileAppTitledEvent domicile_app_titled_event.idl
compare DomicileShortcutEvent domicile_shortcut_event.idl
compare DomicileModifiersEvent domicile_modifiers_event.idl

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
