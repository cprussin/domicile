#!/usr/bin/env bash
# Whether a swap on drm completes without the commit's out-fence.
#
# Upstream `GbmSurfaceless::OnSubmission` completes a swap with the commit's
# out-fence as its release fence. The fence signals at the flip, viz makes
# the GPU wait on it before drawing into the released buffer, and the display
# shares its GL context with raster: a canvas read-back queued after that
# draw waits for the flip, about a frame (patch 0164). The swap completes in
# `OnPresentation` instead, with no fence.
#
# Reads the series rather than a build, so it runs on every push.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# The lines the series takes out of gbm_surfaceless.cc.
removed="$(
  awk '
    /^diff --git a\// { in_file = ($0 ~ /gpu\/gbm_surfaceless[.]cc$/); next }
    !in_file { next }
    /^(\+\+\+|---) / { next }
    /^-/ { print substr($0, 2) }
  ' "$PATCHES"/*.patch
)"

if grep -qF 'SwapCompletionResult(result, std::move(release_fence))' <<<"$removed"; then
  echo "  ok    a swap completes without the out-fence"
else
  echo "  FAIL  a swap completes without the out-fence"
  echo "    OnSubmission still hands viz the commit's out-fence, so every GPU"
  echo "    job after the next draw waits for the flip."
  exit 1
fi
