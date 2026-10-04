#!/usr/bin/env bash
# Checks resizing a <webview> does not hold back the shell's frame.
#
# A <webview> guest is embedded like an out-of-process <iframe>. Upstream uses
# `cc::DeadlinePolicy::UseDefaultDeadline()`, so viz delays the shell's frame
# until the guest draws at its new size. A shell resizes on every frame of a
# drag, so the whole desktop would wait on one page.
#
# The patches embed a <webview> with `UseSpecifiedDeadline(0u)`, as <app>
# does; viz draws the guest's latest surface meanwhile. An ordinary <iframe>
# keeps the default, since it is part of its page's layout.
#
# Reads the patches, not a Chromium tree, so it runs in the shell group.
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

# Prints every line the series adds to <file>.
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
