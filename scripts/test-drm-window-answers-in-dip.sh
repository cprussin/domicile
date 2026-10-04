#!/usr/bin/env bash
# Checks that the patch series replaces the seven `NOTREACHED()` bodies in
# `DrmWindowHost`'s `PlatformWindow` methods.
#
# Upstream assumes nothing calls them, which holds on ChromeOS:
#
#   // No scaling at DRM level and should always use pixel bounds.
#   NOTREACHED();
#
# A views browser on Linux calls `GetBoundsInDIP()` during startup
# (`WindowTreeHost::InitHost()` via `CalculateRootWindowBounds()`), then
# `SizeConstraintsChanged()`, and the rest during normal window operations.
# The compiler accepts the missing bodies and the crash lands far from the
# cause, as with `test-fork-elements-know-their-type.sh`.
#
# This reads the patches, not a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# Both bounds methods convert through the delegate, the only thing that knows
# the scale factor (`DesktopWindowTreeHostPlatform` overrides the identity
# default).
want_set='SetBoundsInPixels(delegate_->ConvertRectToPixels(bounds))'
want_get='return delegate_->ConvertRectToDIP(bounds_)'

# Added lines only (`^+`): the old `NOTREACHED()` bodies appear as context in
# any patch touching nearby lines.
added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"

FAILED=0
check() { # what, needle
  case "$added" in
    (*"$2"*) printf '  ok    %s\n' "$1" ;;
    (*) printf '  FAIL  %s\n    no patch adds: %s\n' "$1" "$2"; FAILED=$((FAILED + 1)) ;;
  esac
}

check "SetBoundsInDIP converts through the delegate" "$want_set"
check "GetBoundsInDIP converts through the delegate" "$want_get"

# The other five. Stubbing all seven was needed for the browser process to
# start; fixing only the ones reached at startup would move the crash.
check "IsVisible answers from what Show and Hide set" "return visible_"
check "SetRestoredBoundsInDIP converts through the delegate" \
  "restored_bounds_ = delegate_->ConvertRectToPixels(bounds)"
check "GetRestoredBoundsInDIP falls back to the current bounds" \
  "delegate_->ConvertRectToDIP(restored_bounds_.value_or(bounds_))"
check "Show records that the window is visible" "visible_ = true"
check "Hide records that it is not" "visible_ = false"

# `SetWindowIcons` and `SizeConstraintsChanged` become empty bodies, so they
# have no added line to match. The removal check below covers them.

# The `NOTREACHED()` bodies must be removed, not just preceded by new code that
# still falls through to them. Scoped to `drm_window_host.cc`'s hunks, since
# the series removes `NOTREACHED();` in many other files.
removed="$(awk '
  /^diff --git a\// { in_file = ($0 ~ /drm_window_host\.cc$/) }
  in_file && /^-/ { print }
' "$PATCHES"/*.patch 2>/dev/null || true)"
case "$removed" in
  (*'No scaling at DRM level and should always use pixel bounds.'*)
    printf '  ok    %s\n' "the ChromeOS-only premise is removed, not just added past" ;;
  (*)
    printf '  FAIL  %s\n    no patch removes the "No scaling at DRM level" comment\n' \
      "the ChromeOS-only premise is removed, not just added past"
    FAILED=$((FAILED + 1)) ;;
esac

# All seven bodies are reachable from a views browser, so count the removals.
gone="$(printf '%s\n' "$removed" | grep -c '^-  NOTREACHED();' || true)"
if [ "$gone" -ge 7 ]; then
  printf '  ok    all seven NOTREACHED() bodies are removed (%s)\n' "$gone"
else
  printf '  FAIL  only %s of seven NOTREACHED() bodies are removed\n' "$gone"
  FAILED=$((FAILED + 1))
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
