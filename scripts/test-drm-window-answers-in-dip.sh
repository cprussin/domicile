#!/usr/bin/env bash
# Whether the DRM platform's window answers the seven questions startup asks.
#
# `DrmWindowHost` ships seven `PlatformWindow` methods as `NOTREACHED()`, on a
# premise that two of them state outright and the other five assume:
#
#   // No scaling at DRM level and should always use pixel bounds.
#   NOTREACHED();
#
# On ChromeOS `ash` never routes a window through
# `DesktopWindowTreeHostPlatform`, so nothing ever asks. A views browser on
# Linux asks during startup -- `WindowTreeHost::InitHost()` calls
# `DesktopWindowTreeHostPlatform::CalculateRootWindowBounds()`, which calls
# `GetBoundsInDIP()` -- and the browser dies there, twenty frames past the
# `CreateScreen()` that `DrmScreen` was written to answer.
#
# `SizeConstraintsChanged()` is the next one startup reaches, and the rest sit
# behind ordinary window operations a running browser gets to. So this guards
# all seven rather than the one the first crash named.
#
# THIS IS THE SAME SPECIES OF BUG AS THE MISSING `GetElementType` OVERRIDE, and
# it is guarded the same way, for the same reason: it is one line that has to
# exist, the compiler is happy without it, and what it costs is a crash a long
# way from the cause. See `test-fork-elements-know-their-type.sh`, which exists
# because `<app>` shipped without its override and took two days to find.
#
# NO CHROMIUM TREE. The series is the source of truth, so this reads the
# patches -- which is what makes it cheap enough to run in the shell group on
# every push rather than only when the fork is built.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# The two bounds methods, and what each must end up doing. `SetBoundsInDIP`
# converts and forwards; `GetBoundsInDIP` converts and returns. Both go through
# the delegate, because the delegate is the only thing that knows the scale factor
# -- `PlatformWindowDelegate`'s own default is the identity, and
# `DesktopWindowTreeHostPlatform` overrides it with the real one.
want_set='SetBoundsInPixels(delegate_->ConvertRectToPixels(bounds))'
want_get='return delegate_->ConvertRectToDIP(bounds_)'

# Added lines only (`^+`), so a patch that merely quotes the old body in
# context cannot satisfy this. That distinction is the whole point: the old
# `NOTREACHED()` bodies appear as context in any patch that touches the file
# near them.
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

# The other five. A views browser asks two of them during startup --
# GetBoundsInDIP first and SizeConstraintsChanged second -- and the build host
# established by stubbing all seven that the browser process then stops failing
# entirely. Fixing only the ones startup reaches today would move the crash
# rather than remove it, and the next one along would be found by another
# four-hour build.
check "IsVisible answers from what Show and Hide set" "return visible_"
check "SetRestoredBoundsInDIP converts through the delegate" \
  "restored_bounds_ = delegate_->ConvertRectToPixels(bounds)"
check "GetRestoredBoundsInDIP falls back to the current bounds" \
  "delegate_->ConvertRectToDIP(restored_bounds_.value_or(bounds_))"
check "Show records that the window is visible" "visible_ = true"
check "Hide records that it is not" "visible_ = false"

# `SetWindowIcons` and `SizeConstraintsChanged` become empty bodies, so there is
# no added line to match on. What is asserted instead is that their
# `NOTREACHED()`s are gone, which the removal check below covers for all seven
# at once.

# The other direction: the `NOTREACHED()` bodies must be GONE, not merely
# accompanied. A patch that adds the delegation without removing the
# `NOTREACHED()` above it compiles and still dies -- so the removal is asserted
# as a removal (`^-`), which is the positive control this guard would be
# worthless without.
#
# Scoped to `drm_window_host.cc`'s own hunks. `NOTREACHED();` is removed all
# over a fork this size, and counting them across the whole series would let
# seven removals somewhere else stand in for the seven that matter -- which is
# exactly the kind of accidental green this guard exists to refuse.
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

# SEVEN, COUNTED. The file holds seven `NOTREACHED()` bodies and every one is a
# method a views browser can reach; leaving any behind leaves a crash for a
# later build to find. Counting the removals is what makes this a check on the
# whole cluster rather than on whichever two were noticed first.
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
