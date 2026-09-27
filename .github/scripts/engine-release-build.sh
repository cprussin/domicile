#!/usr/bin/env bash
# The shippable configuration of the engine.
#
#   .github/scripts/engine-release-build.sh /build/chromium/src out/Release
#   DOMICILE_ENGINE_BUILD=official .github/scripts/engine-release-build.sh ...
#
# Run inside Chromium's toolchain shell, which is what supplies the host tools
# gn probes for. Extra arguments are extra targets: engine.yml builds its
# checks' binaries here too, so it builds once.
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
#   is_official_build = false   by default. It turns on PGO and ThinLTO, which
#                               a pull request's checks do not need and would
#                               pay for on every link
#   dcheck_always_on = true     by default: CI's checks run against this
#                               build, and they had DCHECKs when they ran
#                               against build.sh's
#
# DOMICILE_ENGINE_BUILD=official is the production build, the one users run,
# into an out directory of its own: official, so PGO and ThinLTO as in Chrome,
# and no DCHECKs, which in a non-official build come with EXPENSIVE_DCHECKs in
# every process on the desktop. PGO needs Google's profile for this revision,
# which a checkout has only if something fetched it, so this fetches it.
#
# The ozone arguments are copied from build.sh rather than shared, because they
# are the same for a reason that could stop being true: this is the build a
# person downloads, and it can want a platform the measurement build does not.
set -u

CHROMIUM="${1:-}"
OUT="${2:-out/Release}"

if [ -z "$CHROMIUM" ]; then
  echo "usage: engine-release-build.sh <path to chromium/src> [out dir] [targets...]" >&2
  exit 1
fi

# Before anything is touched: a build nobody defined is a typo, and falling
# back to either real one would publish the wrong engine under the right name.
case "${DOMICILE_ENGINE_BUILD:-checked}" in
  (checked) OFFICIAL=false; DCHECKS=true ;;
  (official) OFFICIAL=true; DCHECKS=false ;;
  (*)
    echo "DOMICILE_ENGINE_BUILD is '$DOMICILE_ENGINE_BUILD'; the builds are 'checked' and 'official'." >&2
    exit 1
    ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"

# `gn` and `autoninja` are depot_tools', not the nix shell's, and a systemd
# service has no shell config to put them on PATH. Which one, and why the
# checkout's own vendored clone is the wrong answer, is engine-depot-tools.sh.
TOOLS="$("$HERE/engine-depot-tools.sh" "$CHROMIUM")" || exit 127
echo "depot_tools: $TOOLS"
export PATH="$TOOLS:$PATH"

cd "$CHROMIUM" || exit 1

# A COMPILER CACHE WHEN THE MACHINE HAS ONE. `gn` bakes `cc_wrapper` into
# every compile command, so adding or dropping this line is a full rebuild --
# which is why a named wrapper that cannot be run is refused here rather than
# skipped, and refused before `gn gen` rewrites out/Domicile.
#
# The value is a stable path and not a store path, so bumping ccache does not
# rewrite every command. See cprussin/dotfiles chromium-build.nix.
CACHE_ARG=""
WRAPPER="${DOMICILE_CC_WRAPPER:-}"
if [ -n "$WRAPPER" ]; then
  # `command -v` rather than `[ -x ]`, so `cc_wrapper = "ccache"` -- the form
  # Chromium's cc_wrapper.gni documents -- is not refused for looking like a
  # relative path. It answers for a shell builtin too; the worst of that is `:`,
  # which compiles nothing and exits 0, so the build dies at the first link
  # rather than the first compile. Still loud, still not a silent rebuild.
  if ! command -v "$WRAPPER" >/dev/null 2>&1; then
    echo "DOMICILE_CC_WRAPPER names $WRAPPER, which nothing here can run." >&2
    echo "Carrying on without it would be a silent rebuild of the whole of" >&2
    echo "Chromium, so this stops. Unset it to build with no cache." >&2
    exit 1
  fi
  CACHE_ARG="  cc_wrapper = \"$WRAPPER\"
"

  # ONE CACHE FOR EVERY TREE, which is what Chromium's Linux build instructions
  # ask for when there is more than one checkout. crux builds in
  # /build/trees/tree-N/src and picks N per run, so a compile keyed on its
  # tree misses in every other: run 36236156550 got 0 hits out of 44,033 in
  # tree-1, minutes after tree-0 had built nearly the same series. BASEDIR
  # makes ccache hash paths under the tree relative to it, and NOHASHDIR keeps
  # the working directory out of the hash. Physical, as ccache compares it
  # with getcwd. Exported, not ccache.conf, so it holds on any machine.
  CCACHE_BASEDIR="$(pwd -P)"
  export CCACHE_BASEDIR
  export CCACHE_NOHASHDIR=1
fi

# The profiles an official build reads: Chrome's, for `chrome_pgo_phase = 2`,
# and V8's builtins', which `gen/v8/embedded.S` depends on outright -- run
# 36339801978 stopped there without it. The same two commands Chromium's DEPS
# runs when `checkout_pgo_profiles` is set; each a no-op when the profile for
# this revision is already here.
if [ "$OFFICIAL" = true ]; then
  python3 tools/update_pgo_profiles.py --target=linux update \
    --gs-url-base=chromium-optimization-profiles/pgo_profiles || exit 1
  python3 v8/tools/builtins-pgo/download_profiles.py download \
    --depot-tools "$TOOLS" --check-v8-revision --quiet || exit 1
fi

# Regenerated whenever the arguments here change, which `gn gen` decides for
# itself by comparing them: passing --args every time is what makes editing
# this file take effect without anybody remembering to delete the directory.
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
#
# `use_libinput` IS NOT AN OZONE ARGUMENT, and it is here anyway. Without it
# `CreateConverter` has no touchpad branch off ChromeOS, a pad falls through to
# `EventConverterEvdevImpl`, and that class has no `EV_ABS` case -- a pointer
# nothing can move, reported by nothing. libinput's headers and library are
# already in Chromium's own bullseye sysroot, so this costs a line. Patch 0027
# is what makes the descriptor logind opened reach it.
gn gen "$OUT" --args="
  is_debug = false
  is_component_build = false
  is_official_build = $OFFICIAL
  dcheck_always_on = $DCHECKS
  symbol_level = 0
  blink_symbol_level = 0
  use_ozone = true
  ozone_auto_platforms = false
  ozone_platform_wayland = true
  ozone_platform_headless = true
  ozone_platform_drm = true
  use_libinput = true
$CACHE_ARG" || exit 1

# `chrome` is the browser; `domicile_engine` is the library the compositor
# dlopens and nothing in chrome depends on, so it has to be named.
exec autoninja -C "$OUT" chrome domicile_engine "${@:3}"
