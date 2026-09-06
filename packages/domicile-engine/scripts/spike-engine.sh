#!/usr/bin/env bash
# Phase 1's library, asserted end to end: libdomicile_engine.so joins the
# browser's mojo graph, is brokered a frame sink, and delivers a configure and a
# frame across a pollable fd to a process that is not Chromium.
#
#   NIX_SHELL_RUN=".../scripts/spike-engine.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# The harness is domicile_engine_smoke, and it is C rather than C++ on purpose:
# the seam is a C ABI because domicile-compositor is Rust and cannot consume a
# GN-built C++ target any other way, so a header that only compiled as C++ would
# not be the seam the design calls for. Building it is the compiler checking
# that claim; running it is everything else.
#
# It stands in for the calloop the compositor already runs — poll the fd,
# dispatch when it wakes — and exits 0 only once both a configure and a frame
# have arrived. Any page that calls embedExternalSurface() will do; the resize
# page is used because it is the smallest.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-engine.sh <path to chromium/src>" >&2
  exit 1
fi

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

PRODUCER=domicile_engine_smoke \
PAGE="${PAGE:-$SCRIPTS/spike-resize-page.html}" \
PAGE_QUERY="${PAGE_QUERY:-?color=00C853}" \
WINDOW_SIZE="${WINDOW_SIZE:-1200,1000}" \
SOCKET="${SOCKET:-/tmp/domicile-spike-engine}" \
PROFILE="${PROFILE:-/tmp/domicile-spike-engine-profile}" \
  "$SCRIPTS/spike.sh" "$CHROMIUM"
