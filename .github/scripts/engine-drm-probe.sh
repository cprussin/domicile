#!/usr/bin/env bash
# Does a patched tree accept `ozone_platform_drm = true`, and does //ui/ozone
# compile with it? Run from inside Chromium's own toolchain shell.
#
#   NIX_SHELL_RUN=".../engine-drm-probe.sh /build/chromium/src /tmp/domicile-drm-probe" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# A FILE, NOT A STRING, for the reason engine-build.sh is one: everything in
# NIX_SHELL_RUN is re-quoted twice on the way in, and a message with a
# semicolon in it came out the far end as `looked: command not found`.
#
# ITS OWN OUT DIRECTORY, and that is not tidiness. `out/Domicile` is what every
# guard in engine.yml loads and what engine-release-build.sh packages, and
# `gn gen` on an existing directory with different arguments reconfigures it --
# so a probe pointed at `out/Domicile` would silently leave the next release
# build configured for DRM, or force a four-hour rebuild of a tree that is warm
# on purpose. The probe's directory is removed by the caller when it is done.
#
# TWO SENTINELS, because the two failures are different questions:
#
#   <prefix>-ran      this script started, so Chromium's shell really ran it.
#                     Without it, a shell that entered nothing and exited 0 is
#                     indistinguishable from a build that worked -- which is
#                     what happened twice in engine.yml's first weeks.
#   <prefix>-built    autoninja finished. This is the answer.
#
# The exit status is not the answer, and cannot be: upstream's shell is a
# buildFHSEnv whose shellHook execs bwrap, and a command run through it does
# not reliably carry its status back out.
set -uo pipefail

CHROMIUM="${1:?usage: engine-drm-probe.sh <chromium/src> <sentinel prefix>}"
PREFIX="${2:?usage: engine-drm-probe.sh <chromium/src> <sentinel prefix>}"

touch "$PREFIX-ran"

# `gn` and `autoninja` are depot_tools', not the nix shell's, and a systemd
# service has no shell config to put them on PATH. Which depot_tools is not a
# matter of taste: a checkout's vendored `third_party/depot_tools` is a plain
# git clone whose bootstrap has never run, and its `autoninja` exits with
# "python3_bin_reldir.txt not found".
#
# COPIED FROM engine-build.sh RATHER THAN SHARED WITH IT, deliberately and for
# one run's worth of reasons: engine-build.sh is what produces the artefact
# every guard and every release loads, this is a workflow_dispatch-only probe,
# and refactoring the first to serve the second would put a change to the
# shipped build in a change that is meant to compile nothing that ships. If a
# third caller ever wants this, that is when it becomes a file. The precedent
# is engine-release-build.sh, which copies build.sh's ozone arguments and says
# so.
TOOLS=""
for candidate in /build/depot_tools "$CHROMIUM/third_party/depot_tools"; do
  if [ -x "$candidate/autoninja" ] && [ -f "$candidate/python3_bin_reldir.txt" ]; then
    TOOLS="$candidate"
    break
  fi
done
[ -n "$TOOLS" ] || {
  echo "drm probe: no bootstrapped depot_tools in /build/depot_tools or $CHROMIUM/third_party/depot_tools"
  exit 127
}
echo "depot_tools: $TOOLS"
export PATH="$TOOLS:$PATH"

cd "$CHROMIUM" || exit 1

# The three non-ozone arguments are build.sh's, and they are here for its
# reasons: small and fast rather than shippable. They also keep the answer
# transferable -- a probe configured differently from the engine would be
# answering about a build nobody makes.
#
# The four ozone ones are the question. `ozone_auto_platforms = false` because
# with it true `is_linux` turns on wayland and x11 as well, which are not what
# is being asked about and are another twenty minutes; headless because the
# engine always has it and because `ozone_platform` has to name something that
# exists; and drm, which is the whole point and which at this pin no Domicile
# build has ever been able to set.
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

# `ui/ozone` rather than `chrome`: //ui/ozone:ozone public_deps :platform,
# whose deps carry ozone_platform_deps, which //ui/ozone/BUILD.gn appends
# platform/drm:gbm to the moment the argument is true. So this target is
# exactly the 49 .cc files under test and their dependency closure, and
# nothing of the browser on top of them. Whether the browser then STARTS under
# --ozone-platform=drm is a different question and needs a machine with a card
# node, which crux does not have.
echo "drm probe: building ui/ozone"
if ! autoninja -C out/DrmProbe ui/ozone; then
  echo "drm probe: gn gen accepted the arguments and autoninja could not build ui/ozone"
  exit 1
fi

touch "$PREFIX-built"
echo "drm probe: ui/ozone built with ozone_platform_drm = true"
