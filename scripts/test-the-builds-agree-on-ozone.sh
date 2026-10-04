#!/usr/bin/env bash
# Checks that both engine builds enable the same Ozone platforms and leave the
# default platform unset.
#
# `packages/domicile-engine/scripts/build.sh` (measurements) and
# `.github/scripts/engine-release-build.sh` (releases) each carry their own
# `gn gen` arguments, so they can drift.
#
# Adding `ozone_platform_drm = true` is safe only because it does not change
# the default. With `ozone_platform` unset, `generate_ozone_platform_list.py`
# keeps `//ui/ozone/BUILD.gn`'s order, so headless stays first and stays the
# default. Setting `ozone_platform = "drm"` would make DRM the default on every
# machine, including those with no card node.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILDS="$ROOT/packages/domicile-engine/scripts/build.sh
$ROOT/.github/scripts/engine-release-build.sh"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# An empty or renamed file must not pass vacuously.
for build in $BUILDS; do
  [ -f "$build" ] || { echo "no build script at $build" >&2; exit 1; }
  grep -q "^  use_ozone = true$" "$build" || {
    echo "$build has no 'use_ozone = true' line, so this script has stopped" >&2
    echo "reading its gn arguments and would pass every check below" >&2
    exit 1
  }
done

for platform in headless wayland drm; do
  missing=""
  for build in $BUILDS; do
    grep -q "^  ozone_platform_$platform = true$" "$build" ||
      missing="$missing $(basename "$build")"
  done
  if [ -z "$missing" ]; then
    ok "both builds compile the $platform platform"
  else
    fail "both builds compile the $platform platform" \
      "not named in:$missing"
  fi
done

# Touchpads need libinput. Off ChromeOS, `CreateConverter` has no touchpad
# branch (`use_evdev_gestures` is `is_chromeos_device`), so a touchpad falls
# through to `EventConverterEvdevImpl`, which ignores `EV_ABS` and the pointer
# never moves. See patch 0027. Both builds need it so they agree.
for build in $BUILDS; do
  if grep -q "^  use_libinput = true$" "$build"; then
    ok "$(basename "$build") can read a trackpad"
  else
    fail "$(basename "$build") can read a trackpad" \
      "no 'use_libinput = true', so a touchpad gets a converter that ignores it"
  fi
done

# `ozone_auto_platforms = false` makes the list above exhaustive. When true,
# is_linux enables x11 and wayland regardless.
for build in $BUILDS; do
  if grep -q "^  ozone_auto_platforms = false$" "$build"; then
    ok "$(basename "$build") chooses its platforms by hand"
  else
    fail "$(basename "$build") chooses its platforms by hand" \
      "no 'ozone_auto_platforms = false', so gn picks platforms this list does not name"
  fi
done

for build in $BUILDS; do
  if grep -qE "^[[:space:]]*ozone_platform = " "$build"; then
    fail "$(basename "$build") leaves the default platform alone" \
      "it sets ozone_platform, which moves that platform to the front of the generated list and makes it the default for every run"
  else
    ok "$(basename "$build") leaves the default platform alone"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
