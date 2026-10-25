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
# - While its `resizing` attribute is set (patch 0113), it embeds with
#   deadline 0, so an interactive resize never waits on the client. Removing
#   the attribute re-embeds with the default deadline.
# - A <webview>'s guest keeps upstream's default deadline, except while the
#   <webview> has `resizing` (patch 0144): then its guest's latest frame
#   stretches to each new box at once, as an <app>'s does.
#
# Reads the series, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
APP="$ENGINE/src/third_party/blink/renderer/core/html/domicile/html_app_element.cc"
IDL="$ENGINE/src/third_party/blink/renderer/core/html/domicile/html_app_element.idl"
[ -f "$APP" ] || { echo "no $APP" >&2; exit 1; }
[ -f "$IDL" ] || { echo "no $IDL" >&2; exit 1; }

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

if grep -q 'kResizingAttr' "$APP" &&
  grep -q 'DeadlinePolicy::UseSpecifiedDeadline(0u)' "$APP"; then
  ok "a resizing <app> does not wait for its window"
else
  fail "a resizing <app> does not wait for its window" \
    "html_app_element.cc embeds nothing with deadline 0 for \`resizing\`"
fi

if grep -q 'Reflect\] attribute boolean resizing' "$IDL" &&
  grep -l '^diff --git a/third_party/blink/renderer/core/html/html_attribute_names.json5' "$ENGINE"/patches/*.patch |
  xargs -r grep -q '^+    "resizing",$'; then
  ok "and the page can set \`resizing\`"
else
  fail "and the page can set \`resizing\`" \
    "html_app_element.idl reflects no \`resizing\`, or no patch names the attribute"
fi

CHILD="$(grep -l '^diff --git a/third_party/blink/renderer/core/frame/child_frame_compositing_helper.cc' "$ENGINE"/patches/*.patch)"
if [ -n "$CHILD" ] &&
  grep -q '^+      surface_id, without_waiting ? cc::DeadlinePolicy::UseSpecifiedDeadline(0u)$' "$CHILD" &&
  grep -q '^+                                  : cc::DeadlinePolicy::UseDefaultDeadline());$' "$CHILD"; then
  ok "a resized <webview> waits for its guest"
else
  fail "a resized <webview> waits for its guest" \
    "no patch keeps the default deadline for a child frame not marked to skip it"
fi

if [ -n "$CHILD" ] &&
  grep -q '^+  surface_layer_->SetStretchContentToFillBounds(without_waiting);$' "$CHILD" &&
  grep -q '^+      IsA<HTMLWebViewElement>(owner) &&$' "$CHILD" &&
  grep -q '^+          owner->FastHasAttribute(html_names::kResizingAttr));$' "$CHILD"; then
  ok "unless it is resizing: then its guest stretches to the box at once"
else
  fail "unless it is resizing: then its guest stretches to the box at once" \
    "no patch embeds a resizing <webview>'s guest with deadline 0 and stretched"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
