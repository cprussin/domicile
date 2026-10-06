#!/usr/bin/env bash
# Whether the desk page's GPU tiles are sized for one monitor, not the desk.
#
# Upstream sizes GPU tiles from the viewport: a quarter of its height, its full
# width. The desk's viewport spans every monitor, so a tile is a desk-wide row
# of ~10 Mpx, and a layer narrower than a quarter of the desk is one tile. GPU
# raster runs on the thread that draws every monitor, so one such tile costs
# them a frame.
#
# So a widget shown on monitors sends the largest part of it one monitor shows
# (`DomicileTileViewportFor`, tested in `cc/domicile/display_regions_unittest.cc`)
# and a picture layer sizes its tiles from that. It rides the commit, so
# `CommitState`'s copy must carry it to the next one.
#
# Reads the series rather than a build, so it runs on every push.
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

widget_cc="$(net_added_in 'platform/widget/widget_base[.]cc$')"
commit_state_cc="$(net_added_in 'cc/trees/commit_state[.]cc$')"
picture_layer_cc="$(net_added_in 'cc/layers/picture_layer[.]cc$')"

check 'a widget sends the largest part of it one monitor shows' \
  "$widget_cc" 'cc::DomicileTileViewportFor(' \
  "WidgetBase does not size tiles from the monitors it is shown on."

check 'the next commit keeps it' \
  "$commit_state_cc" 'domicile_tile_viewport(prev.domicile_tile_viewport)' \
  "CommitState's copy drops it, so every commit after the one that set it sizes tiles from the desk."

check 'a picture layer sizes its tiles from it' \
  "$picture_layer_cc" 'commit_state.domicile_tile_viewport' \
  "PictureLayer still sizes GPU tiles from the whole viewport."

if [ "$failed" -eq 0 ]; then
  echo "all ok"
  exit 0
fi
echo "$failed failed"
exit 1
