#!/usr/bin/env bash
# Checks a resized <app> or <webview> holds back the shell's frame until its
# window draws at the new size.
#
# Without the wait, viz shows the window's old frame in the new box: an <app>
# stretches it and a <webview> leaves a gap or clips it, until the window
# catches up. The box and the window must change in one frame.
#
# - An <app> embeds the surface for its new box with the default deadline
#   (`html_app_element.cc`, through the `EmbedSurface` overload patch 0102
#   adds).
# - A <webview>'s guest keeps upstream's default deadline: no patch changes
#   how a child frame is embedded.
#
# Reads the series, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
APP="$ENGINE/src/third_party/blink/renderer/core/html/domicile/html_app_element.cc"
[ -f "$APP" ] || { echo "no $APP" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

if grep -q 'DeadlinePolicy::UseDefaultDeadline()' "$APP"; then
  ok "a resized <app> waits for its window"
else
  fail "a resized <app> waits for its window" \
    "html_app_element.cc embeds nothing with UseDefaultDeadline()"
fi

if grep -q 'const cc::DeadlinePolicy& deadline_policy' "$ENGINE"/patches/*.patch; then
  ok "and SurfaceLayerBridge takes the deadline"
else
  fail "and SurfaceLayerBridge takes the deadline" \
    "no patch gives SurfaceLayerBridge::EmbedSurface a DeadlinePolicy"
fi

touching="$(grep -l '^diff --git a/third_party/blink/renderer/core/frame/child_frame_compositing_helper' "$ENGINE"/patches/*.patch)"
if [ -z "$touching" ]; then
  ok "and a resized <webview> waits for its guest"
else
  fail "and a resized <webview> waits for its guest" \
    "these change how a child frame is embedded: $touching"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
