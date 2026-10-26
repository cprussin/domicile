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
#   <webview> has `resizing` (patch 0145): then its guest's latest frame shows
#   in each new box at once, as an <app>'s does.
# - While resizing, that frame shows at its own size, not stretched (patch
#   0149), so it does not snap to the window's own frame on every arrival.
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

# Every patch to the child frame helper, read as one diff of the series.
CHILD="$(grep -l '^diff --git a/third_party/blink/renderer/core/frame/child_frame_compositing_helper.cc' "$ENGINE"/patches/*.patch | xargs -r cat)"
if grep -q '^+      surface_id, without_waiting ? cc::DeadlinePolicy::UseSpecifiedDeadline(0u)$' <<<"$CHILD" &&
  grep -q '^+                                  : cc::DeadlinePolicy::UseDefaultDeadline());$' <<<"$CHILD"; then
  ok "a resized <webview> waits for its guest"
else
  fail "a resized <webview> waits for its guest" \
    "no patch keeps the default deadline for a child frame not marked to skip it"
fi

if grep -q '^+      IsA<HTMLWebViewElement>(owner) &&$' "$ENGINE"/patches/*.patch &&
  grep -q '^+          owner->FastHasAttribute(html_names::kResizingAttr));$' "$ENGINE"/patches/*.patch; then
  ok "unless it is resizing: then its guest shows at once"
else
  fail "unless it is resizing: then its guest shows at once" \
    "no patch embeds a resizing <webview>'s guest with deadline 0"
fi

# Stretched, the latest frame snaps to the window's own on every arrival,
# which reads as jitter during a drag. Each patch that adds the child frame's
# stretch must be followed by one that removes it.
added="$(grep -c '^+  surface_layer_->SetStretchContentToFillBounds(without_waiting);$' <<<"$CHILD")"
removed="$(grep -c '^-  surface_layer_->SetStretchContentToFillBounds(without_waiting);$' <<<"$CHILD")"
if [ "$added" -eq "$removed" ] &&
  grep -q 'SetStretchContentToFillBounds($' "$APP" &&
  grep -q 'params.new_value.IsNull());' "$APP"; then
  ok "and a resizing window's frame shows unstretched"
else
  fail "and a resizing window's frame shows unstretched" \
    "a resizing <webview> stretches its guest, or html_app_element.cc does not unstretch for \`resizing\`"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
