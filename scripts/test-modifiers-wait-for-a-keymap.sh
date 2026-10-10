#!/usr/bin/env bash
# Checks the engine ignores Wayland modifiers until the host sends a keymap.
#
# A host that sends `wl_keyboard.modifiers` before `wl_keyboard.keymap` (sway,
# for a seat whose keyboard has gone) crashes upstream in
# `xkb_state_update_mask`. A patch returns no modifiers from
# `XkbKeyboardLayoutEngine::UpdateModifiers` while it has no xkb state, and
# `WaylandKeyboardWithoutKeymapTest` in ozone_unittests covers it.
#
# Reads the patches, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

if in_patches "if (!xkb_state_) {"; then
  ok "UpdateModifiers checks for a keymap"
else
  fail "UpdateModifiers checks for a keymap" \
    "no patch adds the xkb state check, so modifiers before a keymap crash the browser"
fi

if in_patches "TEST_F(WaylandKeyboardWithoutKeymapTest,"; then
  ok "ozone_unittests sends modifiers before a keymap"
else
  fail "ozone_unittests sends modifiers before a keymap" \
    "no patch adds WaylandKeyboardWithoutKeymapTest to wayland_keyboard_unittest.cc"
fi

# A `--gtest_filter` matching nothing exits zero.
FLOORS="$ROOT/scripts/engine-drm-unit-tests.sh"
if grep -qE "^ *WaylandKeyboardWithoutKeymapTest:[0-9]+$" "$FLOORS" 2>/dev/null; then
  ok "the ozone suite list carries a floor for the suite"
else
  fail "the ozone suite list carries a floor for the suite" \
    "no 'WaylandKeyboardWithoutKeymapTest:<n>' in scripts/engine-drm-unit-tests.sh, so the suite can stop running and nothing says so"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
