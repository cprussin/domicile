#!/usr/bin/env bash
# That the build left behind the files and the symbols the guards then load.
#
# `autoninja` can succeed having relinked nothing, and the failure that
# produces is not a build error: the compositor's `dlsym` for an entry point
# returns nothing, and the guard reports that a client's window did not appear.
# That has happened — the `libdomicile_engine.so` the guards loaded had been
# built before the probe grew a coordinate — and it reads as a code error from
# every angle except this one.
#
# So this runs between the build and the guards, and it is the cheapest check
# in the group: a stat and a grep.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

ARTIFACTS=(
  chrome
  libdomicile_engine.so
  components_unittests
  ozone_unittests
  domicile_css_parity
  domicile_color_probe
)

# The entry points the compositor looks up by name. Matched as bytes rather
# than with `nm`, which is not on the runner's PATH: a name absent from the
# file is certainly not exported from it, which is the direction that matters.
SYMBOLS=(
  domicile_engine_connect
  domicile_engine_spike_sample_window_center
  domicile_engine_spike_sample_pixel
  domicile_engine_spike_find_color
)

for artifact in "${ARTIFACTS[@]}"; do
  [ -e "$ENGINE_OUT/$artifact" ] || {
    annotate "the build produced no $artifact in $ENGINE_OUT"
    exit 1
  }
done
ls -l "$ENGINE_OUT/chrome" "$ENGINE_OUT/libdomicile_engine.so"

missing=""
for symbol in "${SYMBOLS[@]}"; do
  grep -qa "$symbol" "$ENGINE_OUT/libdomicile_engine.so" ||
    missing="$missing $symbol"
done
[ -z "$missing" ] || {
  annotate "libdomicile_engine.so is missing:$missing — it is older than the" \
    "source. The build did not fail loudly enough."
  exit 1
}
echo "libdomicile_engine.so exports what the compositor looks up"
