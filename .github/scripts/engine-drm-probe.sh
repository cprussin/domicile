#!/usr/bin/env bash
# Check that a patched tree accepts `ozone_platform_drm = true` and builds
# //ui/ozone and `ozone_unittests` with it. Runs inside Chromium's toolchain
# shell.
#
# The workflow runs `ozone_unittests` in a later step, because it needs
# Chromium's runtime libraries from Domicile's dev shell.
#
#   NIX_SHELL_RUN=".../engine-drm-probe.sh /build/chromium/src /tmp/domicile-drm-probe" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# A script rather than an inline command, because NIX_SHELL_RUN re-quotes its
# contents.
#
# Uses its own out directory: `gn gen` with other arguments would reconfigure
# the release build's directory and force a full rebuild. The caller removes
# it afterward.
#
# Chromium's shell does not reliably return the exit status, so progress is
# reported by sentinel files:
#
#   <prefix>-ran      this script started.
#   <prefix>-built    //ui/ozone compiled and linked.
#   <prefix>-tested   `ozone_unittests` compiled and linked. This is the last
#                     stage; engine-drm-probe-report.sh must match it.
set -uo pipefail

CHROMIUM="${1:?usage: engine-drm-probe.sh <chromium/src> <sentinel prefix>}"
PREFIX="${2:?usage: engine-drm-probe.sh <chromium/src> <sentinel prefix>}"

touch "$PREFIX-ran"

HERE="$(cd "$(dirname "$0")" && pwd)"

# `gn` and `autoninja` come from depot_tools; engine-depot-tools.sh picks which.
TOOLS="$("$HERE/engine-depot-tools.sh" "$CHROMIUM")" || exit 127
echo "depot_tools: $TOOLS"
export PATH="$TOOLS:$PATH"

cd "$CHROMIUM" || exit 1

# The first three arguments match build.sh, so the result applies to the real
# engine. `ozone_auto_platforms = false` skips the wayland and x11 platforms
# that `is_linux` would add. Headless is always on in the engine.
echo "drm probe: configuring out/DrmProbe"
if ! gn gen out/DrmProbe --args='
  is_debug = false
  symbol_level = 0
  is_component_build = true
  use_ozone = true
  ozone_auto_platforms = false
  ozone_platform_headless = true
  ozone_platform_drm = true
'; then
  echo "drm probe: gn gen refused the arguments, so the tree does not accept ozone_platform_drm yet"
  exit 1
fi
echo "drm probe: gn gen accepted ozone_platform_drm = true"

# `ui/ozone` rather than `chrome`: it pulls in platform/drm when the argument
# is set, without the rest of the browser. Starting the browser on DRM needs a
# card node, which crux lacks.
echo "drm probe: building ui/ozone"
if ! autoninja -C out/DrmProbe ui/ozone; then
  echo "drm probe: gn gen accepted the arguments and autoninja could not build ui/ozone"
  exit 1
fi

touch "$PREFIX-built"
echo "drm probe: ui/ozone built with ozone_platform_drm = true"

# The workflow runs all of `ozone_unittests`, including upstream's cases, to
# catch regressions under the DRM platform. engine.yml runs only the fork's own
# suites. The binary runs in `nix develop .#full`, which has Chromium's runtime
# libraries.
echo "drm probe: building ozone_unittests"
if ! autoninja -C out/DrmProbe ozone_unittests; then
  echo "drm probe: ui/ozone built and autoninja could not build ozone_unittests"
  exit 1
fi

touch "$PREFIX-tested"
echo "drm probe: ozone_unittests built"
