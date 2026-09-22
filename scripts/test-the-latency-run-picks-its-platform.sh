#!/usr/bin/env bash
# Which platform the latency run is taken on, and what that changes.
#
# `guard-latency.sh` has two readings now: a window inside somebody else's
# session, which is every CI run, and the screen itself on a console login,
# which is what ROADMAP.md's *keystroke to pixel, on a screen* asks for. The
# measurement is the same either way. What differs is how the engine's window
# is asked for, and where the run may be started from — and both of those are
# decisions rather than plumbing, so they are functions in `lib-latency.sh` and
# this is where they are argued with.
#
# Its own file rather than more of `test-latency-guard.sh`, which is the
# verdict block, or `test-latency-report.sh`, which is the readers. Neither of
# those is about starting a run.
#
# THE SCANOUT CASE CANNOT BE RUN HERE AND THAT IS THE POINT. No runner in CI
# has a panel, so the only thing that can be asserted about the drm path
# without one is what it decides — which is exactly the half that was wrong
# the first time a desktop came up on real hardware, black, with a clean log.
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

# A window in somebody else's session is whatever size it is told, and the
# probe watches the middle of it either way.
expect "a nested run asks for a window of a stated size" \
  "--window-size=1024,768" "$(latency_window_flags wayland)"

# AND THE SCANOUT PLATFORM MUST NOT. `ScreenManager` pairs a window with a
# controller by comparing an exact rectangle against the CRTC's mode, so a
# window of any other size is given no controller and every page flip is
# dropped before it reaches the kernel. That is a black screen with nothing
# wrong in the log, and it is how the first desktop on real hardware came up.
expect "a run that scans out asks for the CRTC's rectangle instead" \
  "--start-fullscreen" "$(latency_window_flags drm)"

# Neither flag may reach the other platform, which is the assertion the two
# above do not make between them: a change that returned both would satisfy
# each of them read alone.
expect "and the two are exclusive, not a superset" \
  "no" "$(case "$(latency_window_flags drm)" in (*--window-size*) echo yes ;; (*) echo no ;; esac)"

echo "where the run may be started from"

# Nothing to refuse: each platform in the place it belongs.
expect "a nested run inside a session is allowed" \
  "" "$(latency_platform_refusal wayland wayland-1)"
expect "a scanout run from a console login is allowed" \
  "" "$(latency_platform_refusal drm "")"

# AND EACH IS REFUSED IN THE OTHER'S PLACE, up front, because neither failure
# says what it is afterwards. `drm` inside a session cannot take DRM master —
# the session already holds it — and what that looks like is a GPU process
# dying minutes into a run that had already started a browser. `wayland` with
# no session has no compositor to be a client of, which is `under-wayland.sh`
# having been forgotten and is the ordinary way this gets run wrongly.
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
