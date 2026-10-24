#!/usr/bin/env bash
# Checks that an image crosses the clipboard between the compositor and the
# browser on a tty, not only text.
#
# The compositor hands the engine `DomicileClipboardItem`s
# (`domicile_clipboard_set_items`, `copied_items`), the broker carries them as
# a map keyed by MIME type, and a patch gives `OzonePlatform` the same map
# (`DomicileClipboardContents`) for `DrmClipboard`. `DrmClipboardTest` in
# ozone_unittests covers the browser's end; `tests/selection.rs` the
# compositor's.
#
# Reads the source, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
HEADER="$ENGINE/src/components/domicile/engine/domicile_engine.h"
BINDING="$ROOT/packages/domicile-compositor/src/engine.rs"
[ -f "$HEADER" ] || { echo "no C header at $HEADER" >&2; exit 1; }
[ -f "$BINDING" ] || { echo "no compositor binding at $BINDING" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

for name in domicile_clipboard_set_items copied_items; do
  if grep -q "$name" "$HEADER" && grep -q "$name" "$BINDING"; then
    ok "the header declares $name and the compositor binds it"
  else
    fail "the header declares $name and the compositor binds it" \
      "$name is missing from $HEADER or $BINDING, so only text crosses"
  fi
done

added="$(cat "$ENGINE"/patches/*.patch 2>/dev/null | grep -a '^+' || true)"
case "$added" in
  (*"const DomicileClipboardContents& contents"*)
    ok "OzonePlatform hands DrmClipboard contents by MIME type" ;;
  (*)
    fail "OzonePlatform hands DrmClipboard contents by MIME type" \
      "no patch gives SetDomicileClipboard a DomicileClipboardContents, so the browser takes only text" ;;
esac

# A `--gtest_filter` matching nothing exits zero.
FLOORS="$ROOT/packages/domicile-engine/scripts/drm-unit-tests.sh"
if grep -qE "^ *DrmClipboardTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the ozone suite list carries a floor for DrmClipboardTest"
else
  fail "the ozone suite list carries a floor for DrmClipboardTest" \
    "no 'DrmClipboardTest:<n>' in packages/domicile-engine/scripts/drm-unit-tests.sh, so the suite does not run"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
