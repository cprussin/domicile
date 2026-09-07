#!/usr/bin/env bash
# Configure and build the engine with the args the spike is measured under.
#
#   ./scripts/build.sh /build/chromium/src
#
# Small and fast rather than shippable: a component build with no symbols and
# every Ozone platform off but the three this needs.
#
# ALL THREE, not one at a time. Ozone picks its platform at runtime from
# `--ozone-platform`, so one binary covers every way a desktop gets on a
# screen, and which one is a property of where it is started rather than of
# which build somebody fetched:
#
#   wayland   nested in an existing session — a window, like running sway
#             inside sway. What a developer has, and what CI drives
#   drm       a tty, with no display server under it. The whole screen, and
#             the real thing: this is a Domicile session
#   headless  no display at all, which is what `crux` has
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
    ozone_platform_drm = true
  ' || exit 1
fi

exec autoninja -C "$OUT" chrome domicile_solid_color_submitter
