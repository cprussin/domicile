#!/usr/bin/env bash
# Checks a touchpad pinch always zooms the desk, whatever window is under the
# pointer.
#
# Upstream hit-tests a touchpad pinch and offers it to the page under the
# pointer as a synthetic ctrl+wheel; here that page can be a browser window or
# an `<app>`, which forwards it to its native client. A patch sends every
# pinch straight to the root view's page scale instead.
#
# Reads the patches, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

router="$(cat "$PATCHES"/*.patch 2>/dev/null |
  awk '/^diff --git/ { on = ($0 ~ /render_widget_host_input_event_router\.cc/) } on && /^\+/')"
has() { case "$router" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

if has "pinch.SetNeedsWheelEvent(false);" &&
   has "root_view->ProcessGestureEvent(pinch, latency);"; then
  ok "a touchpad pinch goes to the root view, without a synthetic wheel"
else
  fail "a touchpad pinch goes to the root view, without a synthetic wheel" \
    "no patch sends it from RouteTouchpadGestureEvent to the root's page scale"
fi

if has "pinch.has_native_pinch = false;"; then
  ok "the desk's pinch is not a native app's"
else
  fail "the desk's pinch is not a native app's" \
    "the pinch keeps its NativePinch, which lets an <app> claim it"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
