#!/usr/bin/env bash
# Checks a touchpad pinch over a browser window zooms that window, and never
# the desk.
#
# Upstream hands a pinch an inner WebContents' page left alone to the
# outermost page, which here is the desk: the whole desktop zoomed. A patch
# gives it to the inner WebContents' delegate instead, `WebViewGuest` zooms
# its page, and the root view no longer page-scales from a touchpad pinch.
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
GUEST="$ENGINE/src/components/domicile/browser/web_view_guest.cc"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
removed="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^-' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

if in_patches "virtual void DomicilePinchZoom(WebContents* source, float scale) {}"; then
  ok "WebContentsDelegate has DomicilePinchZoom, dropping it by default"
else
  fail "WebContentsDelegate has DomicilePinchZoom, dropping it by default" \
    "no patch adds DomicilePinchZoom to web_contents_delegate.h"
fi

if in_patches "contents->GetOuterWebContents()" &&
   in_patches "contents->GetDelegate()->DomicilePinchZoom("; then
  ok "a child frame's unconsumed pinch goes to its inner WebContents"
else
  fail "a child frame's unconsumed pinch goes to its inner WebContents" \
    "render_widget_host_view_child_frame.cc still hands it to the outermost page"
fi

case "$removed" in
  (*"-  ForwardTouchpadZoomEventIfNecessary(event, ack_result);"*)
    ok "the root view never page-scales from a touchpad pinch" ;;
  (*)
    fail "the root view never page-scales from a touchpad pinch" \
      "render_widget_host_view_aura.cc still forwards touchpad zoom, so the desk zooms" ;;
esac

if grep -q "void WebViewGuest::DomicilePinchZoom" "$GUEST" &&
   grep -q "ZoomTo(factor);" "$GUEST"; then
  ok "a browser window zooms its page by the pinch"
else
  fail "a browser window zooms its page by the pinch" \
    "web_view_guest.cc does not override DomicilePinchZoom"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
