#!/usr/bin/env bash
# Tests how `lib-latency.sh` sets up a latency run on each platform.
#
# `guard-latency.sh` runs either as a window inside another session (every CI
# run) or on the screen from a console login. The measurement is the same.
# What differs is the window flags and where the run may start.
#
# No CI runner has a panel, so for the drm path this can only check the
# decisions.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-latency.sh
. "$ROOT/packages/domicile-engine/scripts/lib-latency.sh"

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

echo "how the engine's window is asked for"

# A nested window takes any size; the probe watches its center.
expect "a nested run asks for a window of a stated size" \
  "--window-size=1024,768" "$(latency_window_flags wayland)"

# `ScreenManager` gives a window a controller only if its rectangle equals the
# CRTC's mode. Any other size drops every page flip, with a clean log.
expect "a run that scans out asks for the CRTC's rectangle instead" \
  "--start-fullscreen" "$(latency_window_flags drm)"

# Each flag must stay off the other platform. A change returning both flags
# would pass the two cases above.
expect "and the two are exclusive, not a superset" \
  "no" "$(case "$(latency_window_flags drm)" in (*--window-size*) echo yes ;; (*) echo no ;; esac)"

echo "where the run may be started from"

# Each platform in its own place.
expect "a nested run inside a session is allowed" \
  "" "$(latency_platform_refusal wayland wayland-1)"
expect "a scanout run from a console login is allowed" \
  "" "$(latency_platform_refusal drm "")"

# Each platform is refused in the other's place, because neither failure
# explains itself later. `drm` inside a session cannot take DRM master, and the
# GPU process dies minutes into the run. `wayland` without a session has no
# compositor; usually `under-wayland.sh` was forgotten.
expect "drm inside a session is refused, and says where to run it instead" \
  "PLATFORM=drm takes DRM master, and WAYLAND_DISPLAY=wayland-1 says this is already inside a session holding it. Run it from a console login, and not under under-wayland.sh." \
  "$(latency_platform_refusal drm wayland-1)"

expect "and a nested run with no session is refused the same way" \
  "PLATFORM=wayland needs a Wayland session to be a client of, and there is no WAYLAND_DISPLAY. Wrap this in under-wayland.sh, or take the run on a console login with PLATFORM=drm." \
  "$(latency_platform_refusal wayland "")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
