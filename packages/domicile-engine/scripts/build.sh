#!/usr/bin/env bash
# Configure and build the engine with the args the spike is measured under.
#
#   ./scripts/build.sh /build/chromium/src
#
# Small and fast rather than shippable: a component build with no symbols and
# every Ozone platform off but the three this needs.
#
#   wayland   nested in an existing session — a window, like running sway
#             inside sway. What a developer has, and what CI drives
#   headless  no display at all, which is what `crux` has
#   drm       a tty, with no display server underneath at all
#
# Headless is not part of the design; it is what the measurement machine needs.
# crux has no display server and no Wayland compositor, so without it the engine
# cannot be started at all and scripts/spike.sh has nothing to talk to.
#
# DRM WAS UNSETTABLE HERE UNTIL RECENTLY, and the road to it is worth keeping
# because each step was measured rather than read. At this Chromium pin
# `ui/ozone/platform/drm/BUILD.gn` opened with `assert(is_chromeos, "Ozone DRM
# platform is ChromeOS-only")`, and `//ui/ozone/BUILD.gn` makes
# `platform/drm:gbm` a dependency the moment the argument is true, so `gn gen`
# refused before anything was compiled -- run 34152521286. Patch `0012` relaxed
# that assert and run 34623575435 measured the result: `gn gen` accepts the
# argument and `//ui/ozone` compiles and links with it.
#
# What kept it out after that was that nothing stood behind the platform:
# `OzonePlatformDrm::CreateScreen` was `NOTREACHED()` and nothing modesets
# without `//ui/display/manager`. Patch `0013` answered the first and `0016` the
# second, so the embedder exists and the argument goes on.
# `docs/architecture/A-DESKTOP-ON-A-TTY.md` tracks what is left, which is one
# item: taking the card node from logind rather than opening it. A screen has
# lit since.
set -u

CHROMIUM="${1:-}"
OUT="${OUT:-out/Domicile}"

if [ -z "$CHROMIUM" ]; then
  echo "usage: build.sh <path to chromium/src>" >&2
  exit 1
fi

cd "$CHROMIUM" || exit 1

# EVERY TIME, not only when there is no build.ninja. `gn gen` decides for
# itself whether anything changed by comparing the arguments, so passing them
# always costs nothing and is what makes editing this file take effect.
#
# Gated, it did not. `crux` keeps a warm tree on purpose, so a change to these
# arguments was applied on a machine with no `out/Domicile` and silently
# skipped on the one that runs the guards — which means CI went green having
# built with the old arguments and said nothing. The release script has always
# done it this way and says so; this one is the copy that drifted.
#
# THE DEFAULT PLATFORM IS NOT CHANGED BY ADDING ONE, and that is the whole
# safety argument for `ozone_platform_drm = true` below. `ozone_platform` is
# unset here, so `generate_ozone_platform_list.py` never reorders -- it only
# moves a platform to the front when `--default` names one in the list. What is
# left is `//ui/ozone/BUILD.gn`'s own order, which appends headless (line 37)
# before drm (line 43) before wayland (line 56). So headless stays first, stays
# the default, and drm is a platform `--ozone-platform=drm` can ask for rather
# than one anything gets by accident.
#
# It is ordered after `DrmScreen` (patch 0013) and the modeset driver (patch
# 0016) on purpose: a platform with no embedder behind it turns a clear refusal
# into a crash. Both are in the series now.
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

# `domicile_css_parity` alongside the other producer, because `guard-css-and-resize.sh`
# is a thing a person runs and it cannot without one. The BUILD.gn's own header
# has named both since it was written; this script named one, so step 4 needed
# a second command nobody documented here.
# `domicile_color_probe` for the same reason as `domicile_css_parity`:
# guard-webview-framing.sh is a thing a person runs and it cannot without one.
exec autoninja -C "$OUT" chrome domicile_solid_color_submitter \
  domicile_css_parity domicile_color_probe
