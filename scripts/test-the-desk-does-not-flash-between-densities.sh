#!/usr/bin/env bash
# Whether a monitor less dense than the desk keeps showing its own tiles.
#
# THE SHELL FLASHED. Patch 0072 draws each such monitor's part of a layer from
# a tiling at that monitor's scale, falling back to the page's own tiles,
# shrunk, where one of its tiles is not ready. Those tilings lived on the
# active tree only, so every commit that invalidated anything dropped their
# tiles there at activation, and the monitor showed the page's tiles until its
# own were rastered again: a hover, a focus color, a new wallpaper, each a
# region going soft and then sharp. A layer that took a surface of its own --
# a window dragged at an opacity -- gave its tilings up as well, and they came
# back empty on the drop.
#
# So the pending tree keeps them too, and activation waits on their tiles as
# it does on the page's own (patch 0079); a layer keeps them through a surface
# of its own, which it only cannot draw from them through. What a layer keeps
# and draws is `cc/domicile/display_regions.h`'s, and tested there.
#
# NO CHROMIUM TREE. Like test-a-popup-is-drawn-inside-its-window.sh, this reads
# the series rather than a build, so it runs on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

failed=0

# The lines the series leaves added to one file: each patch's additions, less
# any a later patch takes out again.
net_added_in() {
  awk -v want="$1" '
    /^diff --git a\// { in_file = ($0 ~ want); next }
    !in_file { next }
    /^(\+\+\+|---) / { next }
    /^\+/ { added[++n] = substr($0, 2); next }
    /^-/ {
      gone = substr($0, 2)
      for (i = n; i > 0; i--) {
        if (added[i] == gone) { added[i] = ""; break }
      }
    }
    END { for (i = 1; i <= n; i++) if (added[i] != "") print added[i] }
  ' "$PATCHES"/*.patch
}

check() {
  local name="$1" text="$2" pattern="$3" why="$4"
  if grep -qF -- "$pattern" <<<"$text"; then
    echo "  ok    $name"
  else
    echo "  FAIL  $name"
    echo "    $why"
    failed=$((failed + 1))
  fi
}

refuse() {
  local name="$1" text="$2" pattern="$3" why="$4"
  if grep -qF -- "$pattern" <<<"$text"; then
    echo "  FAIL  $name"
    echo "    $why"
    failed=$((failed + 1))
  else
    echo "  ok    $name"
  fi
}

tiling_h="$(net_added_in 'cc/tiles/picture_layer_tiling[.]h$')"
tiling_cc="$(net_added_in 'cc/tiles/picture_layer_tiling[.]cc$')"
required_cc="$(net_added_in 'cc/tiles/tiling_set_raster_queue_required[.]cc$')"
layer_cc="$(net_added_in 'cc/layers/picture_layer_impl[.]cc$')"

check 'a monitor'"'"'s tile on the pending tree is required for activation' \
  "$tiling_h" 'resolution_ != HIGH_RESOLUTION && domicile_display_ratio_ == 0.f' \
  "IsTileRequiredForActivation still asks for HIGH_RESOLUTION alone, so a commit activates before a monitor's tiles are rastered."

check 'activation waits on a monitor'"'"'s tiling' \
  "$required_cc" 'domicile_display_ratio() != 0.f' \
  "TilingSetRasterQueueRequired still walks the high-res tiling alone, and IsReadyToActivate reads that queue."

check 'activation hands a monitor'"'"'s tiling on as one' \
  "$tiling_cc" 'domicile_display_ratio_ = pending_twin->domicile_display_ratio_;' \
  "TakeTilesAndPropertiesFrom does not carry the monitor a tiling is for onto the active tree."

check 'a layer keeps its monitors'"'"' tilings through a surface of its own' \
  "$layer_cc" 'DomicileKeepsDisplayTilings(' \
  "UpdateDomicileDisplayTilings does not ask DomicileKeepsDisplayTilings."

refuse 'a layer'"'"'s tilings are not kept only while it draws from them' \
  "$layer_cc" 'if (high_res != nullptr && DomicileDrawsPerDisplay()) {' \
  "a layer gives up its monitors' tilings whenever it cannot draw from them, and they come back empty."

# The pending tree holds the monitors' tilings now, and a checked build aborts
# on CopyPropertiesTo's "at most a single tiling" unless that counts them out.
check 'a checked build lets the pending tree hold them' \
  "$layer_cc" 'DCHECK_LE(tilings_->num_tilings() - NumDomicileDisplayTilings(), 1u);' \
  "CopyPropertiesTo still DCHECKs one tiling on the pending tree, which holds a monitor's tiling too."

if [ "$failed" -eq 0 ]; then
  echo "all ok"
  exit 0
fi
echo "$failed failed"
exit 1
