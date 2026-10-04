#!/usr/bin/env bash
# Checks that the SDK event types in `domicile-host.ts` declare the same
# fields as the engine's WebIDL event interfaces.
#
# Nothing else keeps them in sync:
#   - an IDL attribute missing from the SDK can only be read with a cast
#   - an SDK field with no IDL attribute type-checks but reads `undefined`
#
# Compares names only. Mapping WebIDL types to TypeScript types is the
# compiler's job.
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

# Attribute names from `readonly attribute <type> <name>;` lines, sorted.
idl_attributes() {
  sed -n 's/^[[:space:]]*readonly attribute[[:space:]].*[[:space:]]\([A-Za-z0-9_]*\);.*/\1/p' \
    "$1" | sort -u
}

# Property names of `export type <Name> = Event & {` in `domicile-host.ts`.
# Assumes the block ends at a `};` in column zero.
sdk_fields() {
  awk -v name="$1" '
    $0 == "export type " name " = Event & {" { inside = 1; next }
    inside && /^};$/ { inside = 0 }
    inside' "$SDK" |
    sed -n 's/^[[:space:]]*readonly[[:space:]]\+\([A-Za-z0-9_]*\)[?]\?:.*/\1/p' |
    sort -u
}

# Both sides must be non-empty first. Otherwise a renamed file or reformatted
# type makes both lists empty and the comparison passes.
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
compare DomicileBatteryEvent domicile_battery_event.idl
compare DomicileClipboardEvent domicile_clipboard_event.idl
compare DomicileFilePreviewEvent domicile_file_preview_event.idl
compare DomicileAppsEvent domicile_apps_event.idl
compare DomicileIdleEvent domicile_idle_event.idl
compare DomicileLockedEvent domicile_locked_event.idl
compare DomicileTrayEvent domicile_tray_event.idl
compare DomicileShellConfigEvent domicile_shell_config_event.idl
compare DomicileNotificationsEvent domicile_notifications_event.idl
compare DomicileOpenUrlEvent domicile_open_url_event.idl

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
