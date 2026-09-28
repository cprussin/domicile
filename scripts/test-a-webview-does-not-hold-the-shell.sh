#!/usr/bin/env bash
# Whether a <webview> being resized can hold back the shell's frame.
#
# A <webview>'s guest is embedded the way an out-of-process <iframe> is: a
# RemoteFrame in the shell's page, whose ChildFrameCompositingHelper puts a
# cc::SurfaceLayer on the guest's surface. Upstream embeds it with
# `cc::DeadlinePolicy::UseDefaultDeadline()`, so every new size the shell gives
# it is a new surface the shell's own CompositorFrame depends on -- and viz
# holds that frame back until the guest draws at the new size, or until the
# deadline passes. That is the whole desktop, every window on it, waiting on one
# page to lay out and raster.
#
# A shell resizes a browser window on every frame of a drag or a tiling
# animation, so it waited on every frame. An <app> never did: its
# SurfaceLayerBridge embeds with `UseSpecifiedDeadline(0u)`, and viz draws the
# client's latest frame until the new one comes. That difference was the whole
# of "a browser window is sluggish to resize and a terminal is not".
#
# So a <webview> embeds as an <app> does, and an ordinary <iframe> still as
# upstream does -- a frame that is part of its page's own layout is right to
# wait for it. Nothing blanks meanwhile: without a fallback, viz draws the
# latest surface of the same allocation group, which a resize stays in.
#
# NO CHROMIUM TREE. This reads the series, which is the source of truth, so it
# is cheap enough for the shell group on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# Every line the series adds to <file>, across every patch that touches it.
added_to() {
  awk -v file="$1" '
    /^diff --git a\// { in_file = ($0 ~ ("/" file "$")) }
    in_file && /^\+[^+]/ { print substr($0, 2) }
  ' "$PATCHES"/*.patch
}

helper="$(added_to 'core/frame/child_frame_compositing_helper.cc')"
case "$helper" in
  (*'UseSpecifiedDeadline(0u)'*) ok "a child frame can be embedded without waiting for it" ;;
  (*) fail "a child frame can be embedded without waiting for it" \
    "no line added to child_frame_compositing_helper.cc embeds with UseSpecifiedDeadline(0u)" ;;
esac
case "$helper" in
  (*'UseDefaultDeadline()'*) ok "and one that should wait still does" ;;
  (*) fail "and one that should wait still does" \
    "the helper no longer embeds anything with UseDefaultDeadline(), so every <iframe> changed too" ;;
esac

remote="$(added_to 'core/frame/remote_frame.cc')"
case "$remote" in
  (*kWebviewTag*WaitForChild::kNo*|*WaitForChild::kNo*kWebviewTag*)
    ok "and a <webview>'s guest is the one that does not" ;;
  (*) fail "and a <webview>'s guest is the one that does not" \
    "remote_frame.cc does not choose WaitForChild::kNo by the owner's webview tag" ;;
esac

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
