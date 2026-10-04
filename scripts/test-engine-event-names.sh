#!/usr/bin/env bash
# Checks that navigator.domicile's event names live in the fork's own list,
# not Blink's.
#
# Blink's core/events/event_type_names.json5 generates a header most of Blink
# includes, so adding a name there recompiles most of Blink (79 minutes on
# engine run 36179223074). The names live in
# modules/domicile/domicile_event_names.h, which only that directory includes.
#
# Without a build, this checks that no patch touches the global list, the
# fork's code names no event through it, and the fork's list, the IDL's
# `on<name>` handlers and the control-arrival guard's list match. The guard
# checks that each name fires.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
DOMICILE="$ENGINE/src/third_party/blink/renderer/modules/domicile"
NAMES_H="$DOMICILE/domicile_event_names.h"

FAILED=0
expect() {
  if [ "$3" = "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}
sorted() { tr ' ' '\n' | sed '/^$/d' | sort | tr '\n' ' '; }

touching="$(grep -l 'event_type_names.json5' "$ENGINE"/patches/*.patch 2>/dev/null | xargs -r -n1 basename | tr '\n' ' ')"
expect "no patch adds to Blink's global event names" "" "$touching"

# Platform events the fork listens to are Blink's to name: `resize` on the
# shell's window reports desktop size changes (DomicileHost::ReportGeometry),
# `keydown` a chord grabbed by name (DomicileHost::PageKeyDown).
# Listed individually so a fork event dispatched through Blink's list fails.
LISTENED_TO="kResize kKeydown"
global="$(grep -oE 'event_type_names::k[A-Za-z]+' "$DOMICILE"/* 2>/dev/null |
  grep -vE "::($(echo "$LISTENED_TO" | tr ' ' '|'))\$" |
  cut -d: -f1 | xargs -r -n1 basename | sort -u | tr '\n' ' ')"
expect "the fork's code names no event through Blink's list" "" "$global"

[ -f "$NAMES_H" ]
expect "the fork's names are in domicile_event_names.h" 0 "$?"

grep -q '"domicile_event_names.cc"' "$DOMICILE/BUILD.gn" &&
  grep -q '"domicile_event_names.h"' "$DOMICILE/BUILD.gn"
expect "and it is built" 0 "$?"

ours="$(sed -n 's/^ *X(\([a-z]*\), *[A-Za-z]*) *\\\?$/\1/p' "$NAMES_H" 2>/dev/null | sorted)"
idl="$(sed -n 's/^ *attribute EventHandler on\([a-z]*\);.*/\1/p' "$DOMICILE/domicile_host.idl" | sorted)"
guard="$(sed -n '/^const EVENT_NAMES = \[/,/^\];/p' "$ENGINE/scripts/guard-control-arrival.js" |
  grep -o '"[a-z]*"' | tr -d '"' | sorted)"

[ -n "$idl" ]
expect "the IDL declares handlers to compare against" 0 "$?"
expect "every on<name> in the IDL has a name in the fork's list" "$idl" "$ours"
expect "and the guard fires every one of them in a real engine" "$idl" "$guard"

# Handlers are generated from the list, so every IDL name has one.
grep -q 'DOMICILE_EVENT_NAMES(DOMICILE_ATTRIBUTE_EVENT_LISTENER)' "$DOMICILE/domicile_host.h"
expect "the host's on<name> handlers are generated from the list" 0 "$?"
grep -q 'DEFINE_ATTRIBUTE_EVENT_LISTENER(' "$DOMICILE/domicile_host.h"
expect "and none still comes from Blink's macro" 1 "$?"

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }
echo "all ok"
