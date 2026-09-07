#!/usr/bin/env bash
# The shippable configuration of the engine.
#
#   .github/scripts/engine-release-build.sh /build/chromium/src out/Release
#
# Run inside Chromium's toolchain shell, which is what supplies the host tools
# gn probes for. See .github/workflows/engine-release.yml.
#
# NOT scripts/build.sh. That one is the configuration every measurement in this
# project was taken under and it should stay the thing a person runs by hand:
# a component build, which links to several hundred .so files by absolute path
# and cannot be moved off the machine that produced it.
#
# The differences, and there are only three that matter:
#
#   is_component_build = false  one `chrome` binary instead of a directory of
#                               libraries. This is the whole reason for a
#                               second output directory
#   is_official_build           deliberately NOT set. It turns on PGO and LTO
#                               and takes the build from four hours to most of
#                               a day, for a speed difference that does not
#                               change whether the seam works. Revisit when
#                               somebody is measuring the shipped thing
#   dcheck_always_on = false    a release should not abort on a DCHECK
#
# The ozone arguments are copied from build.sh rather than shared, because they
# are the same for a reason that could stop being true: this is the build a
# person downloads, and it can want a platform the measurement build does not.
set -u

CHROMIUM="${1:-}"
OUT="${2:-out/Release}"

if [ -z "$CHROMIUM" ]; then
  echo "usage: engine-release-build.sh <path to chromium/src> [out dir]" >&2
  exit 1
fi

# `gn` and `autoninja` are depot_tools', not the nix shell's, and a systemd
# service has no shell config to put them on PATH. The bootstrapped one, not
# the checkout's vendored clone, which has never run its own bootstrap — see
# .github/scripts/engine-build.sh, where guessing that cost a round.
TOOLS=""
for candidate in /build/depot_tools "$CHROMIUM/third_party/depot_tools"; do
  if [ -x "$candidate/autoninja" ] && [ -f "$candidate/python3_bin_reldir.txt" ]; then
    TOOLS="$candidate"
    break
  fi
done
[ -n "$TOOLS" ] || {
  echo "no bootstrapped depot_tools found; run its ensure_bootstrap" >&2
  exit 127
}
export PATH="$TOOLS:$PATH"

cd "$CHROMIUM" || exit 1

# Regenerated whenever the arguments here change, which `gn gen` decides for
# itself by comparing them: passing --args every time is what makes editing
# this file take effect without anybody remembering to delete the directory.
gn gen "$OUT" --args='
  is_debug = false
  is_component_build = false
  is_official_build = false
  dcheck_always_on = false
  symbol_level = 0
  blink_symbol_level = 0
  use_ozone = true
  ozone_auto_platforms = false
  ozone_platform_wayland = true
  ozone_platform_headless = true
  ozone_platform_drm = true
' || exit 1
# `ozone_platform_drm` is what makes a tty a display: chrome takes KMS itself
# and there is no compositor under it, which is a Domicile session rather than
# a window inside somebody else's. One binary carries all three platforms
# because ozone chooses at runtime, so which one a desktop uses is a property
# of where it was started and not of which build was fetched.

# `chrome` is the browser; `domicile_engine` is the library the compositor
# dlopens and nothing in chrome depends on, so it has to be named.
exec autoninja -C "$OUT" chrome domicile_engine
