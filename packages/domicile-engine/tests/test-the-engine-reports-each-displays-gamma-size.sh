#!/usr/bin/env bash
# Checks the engine carries each display's gamma ramp size from the GPU
# process to the compositor, which offers wlr-gamma-control at that size and
# refuses it where it is 0 (docs/DISPLAYS.md#night-light-and-gamma-control).
# Only the GPU process reads the CRTC, so the size crosses:
#
#   CreateDisplaySnapshot -> DisplaySnapshot's mojom -> DrmScreen ->
#   OzonePlatform::GetDomicileGammaSizes -> the broker's Display ->
#   DomicileRampedDisplay
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
SRC="$ENGINE/src"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

# Whether a patch adds a line matching `pattern` to a file ending in `file`.
adds() {
  awk -v file="$1" -v pattern="$2" '
    /^diff --git a\// { in_file = (substr($3, length($3) - length(file) + 1) == file); next }
    in_file && /^\+/ && $0 ~ pattern { found = 1 }
    END { exit !found }
  ' "$PATCHES"/*.patch
}

check() {
  local name="$1" why="$2"; shift 2
  if "$@"; then ok "$name"; else fail "$name" "$why"; fi
}

check "the GPU process reads each CRTC's gamma size" \
  "no patch to common/drm_util.cc calls set_domicile_gamma_size" \
  adds "common/drm_util.cc" "set_domicile_gamma_size[(]"
check "the snapshot's mojom carries the gamma size" \
  "no patch adds 'uint32 domicile_gamma_size;' to display_snapshot.mojom" \
  adds "display_snapshot.mojom" "uint32 domicile_gamma_size;"
check "the snapshot's mojom traits read the gamma size" \
  "no patch to display_snapshot_mojom_traits.cc reads it" \
  adds "display_snapshot_mojom_traits.cc" "domicile_gamma_size[(][)]"
check "a snapshot's clone keeps its gamma size" \
  "no patch to display_snapshot.cc copies it in Clone()" \
  adds "display_snapshot.cc" "set_domicile_gamma_size[(]"
check "the DRM platform lends its screen's gamma sizes" \
  "no patch to ozone_platform_drm.cc overrides GetDomicileGammaSizes" \
  adds "ozone_platform_drm.cc" "GetDomicileGammaSizes[(][)]"
check "the DRM platform takes each display's ramp" \
  "no patch to ozone_platform_drm.cc overrides SetDomicileGamma" \
  adds "ozone_platform_drm.cc" "SetDomicileGamma[(]"

check "the browser sends the gamma size to the engine library" \
  "display_list.cc does not fill the mojom Display's gamma_size" \
  grep -q "gamma_sizes" "$SRC/components/domicile/browser/display_list.cc"
check "the C ABI has ramped_displays" \
  "domicile_engine.h declares no ramped_displays callback" \
  grep -q "(\*ramped_displays)" "$SRC/components/domicile/engine/domicile_engine.h"
check "the C ABI sets one display's gamma" \
  "domicile_engine.h declares no domicile_displays_set_gamma" \
  grep -q "domicile_displays_set_gamma(" "$SRC/components/domicile/engine/domicile_engine.h"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
