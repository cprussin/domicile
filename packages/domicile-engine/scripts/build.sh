#!/usr/bin/env bash
# Configure and build the engine with the args the spike is measured under.
#
#   ./scripts/build.sh /build/chromium/src
#
# Small and fast rather than shippable: a component build with no symbols and
# every Ozone platform off but Wayland and headless. Phase 3 swaps in
# ozone_platform_drm.
#
# Headless is not part of the design; it is what the measurement machine needs.
# crux has no display server and no Wayland compositor, so without it the engine
# cannot be started at all and scripts/spike.sh has nothing to talk to.
set -u

CHROMIUM="${1:-}"
OUT="${OUT:-out/Domicile}"

if [ -z "$CHROMIUM" ]; then
  echo "usage: build.sh <path to chromium/src>" >&2
  exit 1
fi

cd "$CHROMIUM" || exit 1

if [ ! -f "$OUT/build.ninja" ]; then
  gn gen "$OUT" --args='
    is_debug = false
    symbol_level = 0
    is_component_build = true
    use_ozone = true
    ozone_auto_platforms = false
    ozone_platform_wayland = true
    ozone_platform_headless = true
  ' || exit 1
fi

exec autoninja -C "$OUT" chrome domicile_solid_color_submitter
