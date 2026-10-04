#!/usr/bin/env bash
# Whether the desk page's tile memory budget covers every monitor it is on.
#
# Upstream sizes a renderer's budget from the screen its widget starts on. The
# desk page starts on the host monitor and learns the rest later, so it runs a
# ~40 Mpx desk, plus each monitor's tiling, on a laptop's budget. Over budget,
# cc evicts and re-rasters on every commit and draws required tiles as solid
# color: the shell blinks.
#
# So a widget shown on monitors asks for what they need
# (`DomicileTileBytesFor`, tested in `cc/domicile/display_regions_unittest.cc`)
# and the compositor raises its policy to that (patch 0088), unless
# --force-gpu-mem-available-mb names the budget. Both ride the commit, so
# `CommitState`'s copy must carry them to the next one: dropped there, every
# commit after the first sends none.
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

commit_state_cc="$(net_added_in 'cc/trees/commit_state[.]cc$')"
widget_cc="$(net_added_in 'platform/widget/widget_base[.]cc$')"
client_cc="$(net_added_in 'cc/trees/client_layer_tree_host_impl[.]cc$')"
host_impl_cc="$(net_added_in 'cc/trees/layer_tree_host_impl[.]cc$')"

check 'the next commit keeps the monitors'"'"' regions' \
  "$commit_state_cc" 'domicile_display_regions(prev.domicile_display_regions)' \
  "CommitState's copy drops the regions, so every commit after the one that set them clears the monitors' tilings."

check 'the next commit keeps the tile memory asked for' \
  "$commit_state_cc" 'domicile_tile_bytes(prev.domicile_tile_bytes)' \
  "CommitState's copy drops the tile memory, so every commit after the one that set it asks for none."

check 'a widget asks for the tile memory its monitors need' \
  "$widget_cc" 'cc::DomicileTileBytesFor(' \
  "WidgetBase does not size tile memory from the monitors it is shown on."

check 'an explicit --force-gpu-mem-available-mb is the budget' \
  "$widget_cc" 'switches::kForceGpuMemAvailableMb)) {' \
  "WidgetBase raises the budget past one --force-gpu-mem-available-mb set."

check 'the commit hands the tile memory to the compositor' \
  "$client_cc" 'SetDomicileTileBytes(commit_state.domicile_tile_bytes);' \
  "ClientLayerTreeHostImpl does not pull the tile memory a widget asked for."

check 'the compositor raises its policy to it' \
  "$host_impl_cc" 'std::max(actual.bytes_limit_when_visible, domicile_tile_bytes_)' \
  "ActualManagedMemoryPolicy does not raise the budget to the monitors' need, or lowers upstream's."

if [ "$failed" -eq 0 ]; then
  echo "all ok"
  exit 0
fi
echo "$failed failed"
exit 1
