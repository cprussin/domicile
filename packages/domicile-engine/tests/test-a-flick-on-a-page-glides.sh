#!/usr/bin/env bash
# Checks a two-finger flick on a tty gives pages momentum.
#
# libinput reports a scroll stop when the fingers lift and nothing more, so
# without a fling start the browser stops the page dead.
# `src/ui/events/ozone/evdev/domicile/fling_tracker.cc` measures the speed; a
# patch makes the libinput converter start and cancel the fling.
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
SRC="$ENGINE/src"
DOMICILE="$SRC/ui/events/ozone/evdev/domicile"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

for f in fling_tracker.h fling_tracker.cc fling_tracker_unittest.cc; do
  if [ -f "$DOMICILE/$f" ]; then
    ok "domicile/$f exists"
  else
    fail "domicile/$f exists" "no such file under src/ui/events/ozone/evdev/domicile"
  fi
done

if in_patches "EventType::kScrollFlingStart" && in_patches "fling_tracker_.Release("; then
  ok "the libinput converter starts a fling when the fingers lift"
else
  fail "the libinput converter starts a fling when the fingers lift" \
    "no patch dispatches kScrollFlingStart from fling_tracker_.Release"
fi

# Accelerated distances would carry the accelerator's gain into the glide.
if python3 - "$PATCHES" <<'CHECK'
from pathlib import Path
import re
import sys
added = "\n".join(line[1:] for patch in sorted(Path(sys.argv[1]).glob("*.patch"))
                  for line in patch.read_text().splitlines()
                  if line.startswith("+") and not line.startswith("+++"))
linear = re.search(
    r"fling_tracker_\.Scroll\(\s*gfx::Vector2dF\(ScaleScrollAxis\(raw_delta\.x\(\), scroll_factor_\),\s*"
    r"ScaleScrollAxis\(raw_delta\.y\(\), scroll_factor_\)\)", added)
sys.exit(0 if linear else 1)
CHECK
then
  ok "the glide follows the fingers' unaccelerated speed"
else
  fail "the glide follows the fingers' unaccelerated speed" \
    "fling_tracker_ measures accelerated distances, so a fast flick glides up to four times too fast"
fi

if in_patches "EventType::kScrollFlingCancel"; then
  ok "the next scroll stops the glide"
else
  fail "the next scroll stops the glide" \
    "no patch dispatches kScrollFlingCancel, so a new scroll fights the old fling"
fi

if in_patches "== kHoldBegin) {" && in_patches "CancelFling(base::TimeTicks() +"; then
  ok "fingers resting on the pad stop the glide"
else
  fail "fingers resting on the pad stop the glide" \
    "no patch cancels the fling at libinput's hold gesture, so a page glides under resting fingers"
fi

if in_patches '"domicile/fling_tracker.cc"'; then
  ok "the tracker is in the evdev component"
else
  fail "the tracker is in the evdev component" \
    "no patch adds domicile/fling_tracker.cc to ui/events/ozone/evdev/BUILD.gn"
fi

if in_patches '"//ui/events/ozone/evdev/domicile/fling_tracker_unittest.cc"'; then
  ok "the unit test is in ozone_unittests"
else
  fail "the unit test is in ozone_unittests" \
    "no patch adds fling_tracker_unittest.cc to ui/ozone/platform/drm/BUILD.gn"
fi

if grep -qE "^ *FlingTrackerTest:[0-9]+$" "$ENGINE/scripts/drm-unit-tests.sh"; then
  ok "the DRM suite list carries a floor for the suite"
else
  fail "the DRM suite list carries a floor for the suite" \
    "no 'FlingTrackerTest:<n>' in packages/domicile-engine/scripts/drm-unit-tests.sh"
fi

# The native stop is an ended wheel phase, which ends the browser's wheel
# target. A fling start goes only to that target, so after the stop it is
# dropped and the page never glides. Reads what the newest patch that shows
# both leaves in the file.
fling_before_stop() {
  python3 - "$PATCHES" "$@" <<'CHECK'
from pathlib import Path
import sys
patches, path, fling, stop = Path(sys.argv[1]), *sys.argv[2:]
verdict = None
for patch in sorted(patches.glob("*.patch")):
    post, inside = [], False
    for line in patch.read_text().splitlines():
        if line.startswith("diff --git "):
            inside = line.endswith(" b/" + path)
        elif inside and line[:1] in (" ", "+") and not line.startswith("+++"):
            post.append(line[1:])
    starts = [i for i, l in enumerate(post) if fling in l]
    stops = [i for i, l in enumerate(post) if stop in l]
    if starts and stops:
        verdict = starts[0] < stops[0]
sys.exit(0 if verdict else 1)
CHECK
}

if fling_before_stop ui/events/ozone/evdev/libinput_event_converter.cc \
    "fling_tracker_.Release(" "dispatcher_->DispatchScrollEvent(params);"; then
  ok "on a tty the glide starts before the scroll stop"
else
  fail "on a tty the glide starts before the scroll stop" \
    "the converter dispatches the stop first, so the browser drops the fling"
fi

if fling_before_stop ui/ozone/platform/wayland/host/wayland_event_source.cc \
    "is_fling_active_ = true;" "SetScrollMetadata(stopped,"; then
  ok "nested, the glide starts before the scroll stop"
else
  fail "nested, the glide starts before the scroll stop" \
    "the Wayland event source queues the stop first, so the browser drops the fling"
fi

# Once a device has flung, Chromium's MouseWheelPhaseHandler ends a touchpad
# scroll only at a fling start. A slow lift with no fling leaves it mid-scroll,
# and it drops the next scroll's wheels. Wayland sends one at zero speed.
if python3 - "$PATCHES" <<'CHECK'
from pathlib import Path
import sys
path = "ui/events/ozone/evdev/libinput_event_converter.cc"
verdict = None
for patch in sorted(Path(sys.argv[1]).glob("*.patch")):
    post, inside = [], False
    for line in patch.read_text().splitlines():
        if line.startswith("diff --git "):
            inside = line.endswith(" b/" + path)
        elif inside and line[:1] in (" ", "+") and not line.startswith("+++"):
            post.append(line[1:])
    release = [i for i, l in enumerate(post) if "fling_tracker_.Release(" in l]
    start = next((i for i, l in enumerate(post)
                  if release and i > release[0] and "kScrollFlingStart" in l),
                 None)
    if start is not None:
        verdict = not any("IsZero" in l for l in post[release[0]:start])
sys.exit(0 if verdict else 1)
CHECK
then
  ok "a slow lift still ends the scroll with a fling start"
else
  fail "a slow lift still ends the scroll with a fling start" \
    "the converter skips the fling start at zero speed, so the browser drops the next scroll"
fi

# A native client runs its own momentum from the axis stop. The page's
# momentum wheels reaching it too would glide it twice.
APP="$SRC/third_party/blink/renderer/core/html/domicile/html_app_element.cc"
if grep -q "momentum_phase != blink::WebMouseWheelEvent::kPhaseNone" "$APP"; then
  ok "a native window ignores the page's momentum"
else
  fail "a native window ignores the page's momentum" \
    "html_app_element.cc forwards momentum wheels to the native client"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
