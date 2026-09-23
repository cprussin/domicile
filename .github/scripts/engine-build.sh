#!/usr/bin/env bash
# Build the engine, from inside Chromium's shell.
#
#   NIX_SHELL_RUN=".../engine-build.sh /build/chromium/src /tmp/ran" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# A FILE, NOT A STRING. This began as a command composed in the workflow and
# handed through NIX_SHELL_RUN, which meant its quoting was interpreted by the
# workflow's shell, then by chromium-env-run, then by the `bash -c` underneath
# — and a message containing a semicolon came out the far end as
# `looked: command not found`. Three layers of quoting is two too many. A path
# to a script survives all of them unaltered.
set -euo pipefail

CHROMIUM="${1:?usage: engine-build.sh <chromium/src> <sentinel>}"
SENTINEL="${2:?usage: engine-build.sh <chromium/src> <sentinel>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# `gn` and `autoninja` are depot_tools', not the nix shell's, and which
# depot_tools is not a matter of taste — engine-depot-tools.sh is the answer
# and the reasons, in the one place the four scripts that need it share.
TOOLS="$("$HERE/engine-depot-tools.sh" "$CHROMIUM")" || exit 127
echo "depot_tools: $TOOLS"
export PATH="$TOOLS:$PATH"

"$HERE/../../packages/domicile-engine/scripts/build.sh" "$CHROMIUM"

# `domicile_engine` because nothing in chrome depends on it and the compositor
# dlopens it by name; `components_unittests` because patch 0001 registers the
# broker's tests into it.
#
# `ozone_unittests` because the DRM platform's tests had nowhere to run. They
# were written on the build host and executed by `engine-drm-probe.yml`, which
# is `workflow_dispatch` only -- so `DrmScreenTest` and `DrmModesetTest` were
# compiled by nobody's pull request and run by nobody's pull request. That was
# not an oversight: until `ozone_platform_drm = true` went into build.sh, this
# build named only wayland and headless and those suites were not in any binary
# it produced. They are now.
autoninja -C "$CHROMIUM/out/Domicile" domicile_engine components_unittests \
  ozone_unittests

# The proof that this ran at all. Chromium's shell has swallowed an exit status
# more than once in this workflow's short life, so the step that called this
# checks for the file rather than believing the code.
touch "$SENTINEL"

# WHETHER THE CACHE WAS CONSULTED, in the log rather than inferred from how
# long the step took. The unset case matters most: any layer between the
# systemd unit and the compiler can drop the variable without saying so, and a
# run that lost it builds uncached and would otherwise say nothing.
#
# Plain prose, not `::warning::`: engine-build-in-shell.sh echoes this log
# through `sed 's/^/  | /'`, so the runner never parses a workflow command.
# A failed report is caught rather than thrown, because the step's verdict is
# the sentinel -- throwing would only drop the lines after it.
if [ -n "${DOMICILE_CC_WRAPPER:-}" ]; then
  "$DOMICILE_CC_WRAPPER" --show-stats | sed 's/^/  ccache /' || {
    echo "  ccache $DOMICILE_CC_WRAPPER built, then would not report its" \
      "statistics. Whether the cache was consulted is unknown for this run."
  }
else
  echo "  ccache DOMICILE_CC_WRAPPER is unset, so this build used no compiler" \
    "cache. Either this machine's configuration does not set it, or the" \
    "variable did not survive the unit, nix-shell or the FHS sandbox."
fi

echo "engine-build.sh finished"
