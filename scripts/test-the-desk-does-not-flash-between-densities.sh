#!/usr/bin/env bash
# Tests that a monitor less dense than the desk keeps showing its own tiles.
#
# Patch 0072 draws each such monitor's part of a layer from a tiling at that
# monitor's scale, falling back to the page's tiles, shrunk, where its own are
# not ready. If those tilings lived on the active tree only, every invalidating
# commit would drop their tiles and the region would go soft until rastered
# again.
#
# So the pending tree keeps them, and activation waits on their tiles
# (patch 0079). A layer with its own render surface keeps its tilings even
# though it cannot draw from them. `cc/domicile/display_regions.h` decides what
# a layer keeps and draws, and is tested there.
#
# Needs no Chromium tree: like test-a-popup-is-drawn-inside-its-window.sh, it
# reads the series, so it runs on every push.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

failed=0

# The lines the series adds to one file: each patch's additions, less any a
# later patch removes.
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

# The pending tree holds the monitors' tilings, so CopyPropertiesTo's "at most
# a single tiling" DCHECK must not count them.
check 'a checked build lets the pending tree hold them' \
  "$layer_cc" 'DCHECK_LE(tilings_->num_tilings() - NumDomicileDisplayTilings(), 1u);' \
  "CopyPropertiesTo still DCHECKs one tiling on the pending tree, which holds a monitor's tiling too."

# Over budget, TileManager marks required tiles out of memory, and such a tile
# counts as ready to draw: a solid color. A monitor's tile out of memory falls
# back to the page's tile there instead (DomicileDrawsTile).
coverage_h="$(net_added_in 'cc/tiles/tiling_set_coverage_iterator[.]h$')"

check 'a monitor'"'"'s tile out of memory falls back to the page'"'"'s' \
  "$tiling_h" 'DomicileDrawsTile(domicile_display_ratio_,' \
  "PictureLayerTiling does not ask DomicileDrawsTile, so a monitor's tile out of memory is drawn as a solid color."

check 'coverage passes over a tile its tiling does not draw' \
  "$coverage_h" 'DomicileDrawsTile(tile)' \
  "TilingSetCoverageIterator stops at a monitor's tile out of memory instead of falling back."

if [ "$failed" -eq 0 ]; then
  echo "all ok"
  exit 0
fi
echo "$failed failed"
exit 1
