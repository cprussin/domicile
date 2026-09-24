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

# The cache is shared, so its totals would mix every build that ever ran.
if [ -n "${DOMICILE_CC_WRAPPER:-}" ]; then
  "$DOMICILE_CC_WRAPPER" --zero-stats >/dev/null || echo "  ccache" \
    "$DOMICILE_CC_WRAPPER would not zero its statistics, so they span builds."
fi

# One build, the one that ships: out/Release with DCHECKs, plus what the checks
# load. `domicile_engine` because the compositor dlopens it; the test binaries
# and probes because the checks run them.
"$HERE/engine-release-build.sh" "$CHROMIUM" "${OUT_RELEASE:-out/Release}" \
  domicile_unittests ozone_unittests domicile_css_parity domicile_color_probe \
  domicile_solid_color_submitter

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
  "$DOMICILE_CC_WRAPPER" --show-stats -v | sed 's/^/  ccache /' || {
    echo "  ccache $DOMICILE_CC_WRAPPER built, then would not report its" \
      "statistics. Whether the cache was consulted is unknown for this run."
  }
else
  echo "  ccache DOMICILE_CC_WRAPPER is unset, so this build used no compiler" \
    "cache. Either this machine's configuration does not set it, or the" \
    "variable did not survive the unit, nix-shell or the FHS sandbox."
fi

echo "engine-build.sh finished"
