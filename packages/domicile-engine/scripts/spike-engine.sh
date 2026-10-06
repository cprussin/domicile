#!/usr/bin/env bash
# End-to-end check of libdomicile_engine.so: it joins the browser's mojo graph,
# gets a brokered frame sink, and delivers a configure and a frame over a
# pollable fd to a non-Chromium process.
#
#   NIX_SHELL_RUN=".../scripts/spike-engine.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# The harness, domicile_engine_smoke, is written in C so the build checks that
# the header is a plain C ABI, which the Rust compositor needs. It polls the fd
# like the compositor's calloop and exits 0 once a configure and a frame have
# arrived. Any page that calls embedExternalSurface() works; the resize page is
# the smallest.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-engine.sh <path to chromium/src>" >&2
  exit 1
fi

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

PRODUCER=domicile_engine_smoke \
PAGE="${PAGE:-$SCRIPTS/spike-resize-page.html}" \
PAGE_QUERY="${PAGE_QUERY:-?color=00C853&app=domicile-engine-smoke}" \
WINDOW_SIZE="${WINDOW_SIZE:-1200,1000}" \
SOCKET="${SOCKET:-/tmp/domicile-spike-engine}" \
PROFILE="${PROFILE:-/tmp/domicile-spike-engine-profile}" \
  "$SCRIPTS/spike.sh" "$CHROMIUM"
