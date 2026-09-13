#!/usr/bin/env bash
# Configure and build the engine with the args the spike is measured under.
#
#   ./scripts/build.sh /build/chromium/src
#
# Small and fast rather than shippable: a component build with no symbols and
# every Ozone platform off but the three this needs.
#
# Wayland and headless, and NOT drm -- now by choice rather than by refusal.
# `ozone_platform_drm` is what would make a tty a display, and it USED to be
# unsettable here: at this Chromium pin `ui/ozone/platform/drm/BUILD.gn` opened
# with `assert(is_chromeos, "Ozone DRM platform is ChromeOS-only")`, and
# `//ui/ozone/BUILD.gn` makes `platform/drm:gbm` a dependency the moment the
# argument is true, so `gn gen` refused before anything was compiled. Measured,
# not read: run 34152521286.
#
# Patch `0012` relaxed that assert, and run 34623575435 measured the result --
# `gn gen` accepts the argument and `//ui/ozone` compiles and links with it. So
# what keeps drm out of this build is no longer the tree. It is that there is
# nothing behind the platform yet: `OzonePlatformDrm::CreateScreen` is
# `NOTREACHED()` and nothing modesets without `//ui/display/manager`. Building
# the platform in before that embedder exists trades a clear refusal for a
# crash. `docs/architecture/A-DESKTOP-ON-A-TTY.md` tracks that work.
#
#   wayland   nested in an existing session — a window, like running sway
#             inside sway. What a developer has, and what CI drives
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

# EVERY TIME, not only when there is no build.ninja. `gn gen` decides for
# itself whether anything changed by comparing the arguments, so passing them
# always costs nothing and is what makes editing this file take effect.
#
# Gated, it did not. `crux` keeps a warm tree on purpose, so a change to these
# arguments was applied on a machine with no `out/Domicile` and silently
# skipped on the one that runs the guards — which means CI went green having
# built with the old arguments and said nothing. The release script has always
# done it this way and says so; this one is the copy that drifted.
gn gen "$OUT" --args='
  is_debug = false
  symbol_level = 0
  is_component_build = true
  use_ozone = true
  ozone_auto_platforms = false
  ozone_platform_wayland = true
  ozone_platform_headless = true
' || exit 1

# `domicile_css_parity` alongside the other producer, because `guard-css-and-resize.sh`
# is a thing a person runs and it cannot without one. The BUILD.gn's own header
# has named both since it was written; this script named one, so step 4 needed
# a second command nobody documented here.
# `domicile_colour_probe` for the same reason as `domicile_css_parity`:
# guard-webview-framing.sh is a thing a person runs and it cannot without one.
exec autoninja -C "$OUT" chrome domicile_solid_color_submitter \
  domicile_css_parity domicile_colour_probe
