// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CC_DOMICILE_DISPLAY_REGIONS_H_
#define CC_DOMICILE_DISPLAY_REGIONS_H_

#include <cstddef>
#include <vector>

#include "ui/gfx/geometry/rect.h"

namespace gfx {
class Transform;
}

namespace cc {

// One monitor's part of a page shown on several monitors at different scales.
//
// The desk page rasters at the densest monitor's scale. A layer on a less
// dense monitor also keeps a tiling at that monitor's scale, so its tiles map
// 1:1 to the monitor's pixels. See docs/architecture/DISPLAY-TILINGS.md.
struct DomicileDisplayRegion {
  // In the page's viewport, in device pixels at the page's scale.
  gfx::Rect rect;
  // The monitor's scale divided by the page's, in (0, 1). A monitor as dense
  // as the page has no region: it shows the page's own tiles.
  float ratio = 1.f;

  friend bool operator==(const DomicileDisplayRegion&,
                         const DomicileDisplayRegion&) = default;
};

using DomicileDisplayRegions = std::vector<DomicileDisplayRegion>;

// Label of the ScreenInfos entries the browser adds to a desk page, one per lit
// monitor. A widget builds its regions from them.
inline constexpr char kDomicileDisplayLabel[] = "domicile-display";

// A monitor showing a page: its rect in DIPs on the widget's screen, and its
// scale.
struct DomicileDisplay {
  gfx::Rect rect;
  float scale = 1.f;
};

// The regions of a widget at `widget_origin`, rastered at `page_scale`: one per
// monitor less dense than the page, in the widget's device pixels.
DomicileDisplayRegions DomicileDisplayRegionsOf(
    const std::vector<DomicileDisplay>& displays,
    const gfx::Point& widget_origin,
    float page_scale);

// The tile memory a widget at `widget_rect`, rastered at `page_scale`, needs,
// capped at `ceiling_bytes`; 0 when no monitor shows it.
//
// Upstream sizes the budget from the widget's initial screen, which is too
// small for the desk, and a page over budget draws solid-color tiles. See
// docs/architecture/DISPLAY-TILINGS.md#tile-memory.
size_t DomicileTileBytesFor(const std::vector<DomicileDisplay>& displays,
                            const gfx::Rect& widget_rect,
                            float page_scale,
                            size_t ceiling_bytes);

// The most display tilings a layer keeps. TilingSetRasterQueueAll has one
// iterator per tiling (DOMICILE_DISPLAY_*); an extra tiling would never raster
// and would block activation.
inline constexpr size_t kDomicileMostDisplayTilings = 3;

// The distinct ratios of the regions `rect_in_target` meets, ascending, capped
// at the kDomicileMostDisplayTilings lowest.
std::vector<float> DomicileRatiosMeeting(const DomicileDisplayRegions& regions,
                                         const gfx::Rect& rect_in_target);

// The layer properties that decide whether it uses display tilings.
struct DomicileLayer {
  // Whether the layer-to-viewport transform is a scale and translation.
  // Regions can only be mapped through such a transform.
  bool to_page_is_scale_or_translation = false;
  // Drawn directly into the page, not into a render surface of its own.
  bool draws_into_page = false;
  // Drawn at the image's own scale, whatever the page's.
  bool is_directly_composited_image = false;
};

// Whether `layer` keeps a rastered tiling per monitor on both trees.
//
// True even under a render surface, where it cannot draw from them: a dropped
// tiling comes back empty, and the monitor would flash downscaled tiles until
// it rasters again.
bool DomicileKeepsDisplayTilings(const DomicileLayer& layer);

// Whether `layer` draws each monitor's part from that monitor's tiling.
bool DomicileDrawsFromDisplayTilings(const DomicileLayer& layer);

// The bounds of every region with `ratio`, in the layer space `to_target` maps
// from. Empty unless `to_target` is a scale and translation: a rotated layer
// draws from its own tiles everywhere.
gfx::Rect DomicileRegionInLayer(const DomicileDisplayRegions& regions,
                                float ratio,
                                const gfx::Transform& to_target);

// A part of a layer's drawn area and the tiling it draws from: the one at the
// layer's scale times `ratio`.
struct DomicileCoveragePiece {
  gfx::Rect rect;
  float ratio = 1.f;
};

// Splits `visible`, in the space `to_target` maps from, along the regions: each
// region's part at its ratio, the rest at 1. The pieces tile `visible` without
// overlap, so no quad is drawn twice; where regions overlap (mirrored
// monitors), the first wins. All of `visible` is at 1 unless `to_target` is a
// scale and translation.
std::vector<DomicileCoveragePiece> DomicileCoverage(
    const DomicileDisplayRegions& regions,
    const gfx::Transform& to_target,
    const gfx::Rect& visible);

}  // namespace cc

#endif  // CC_DOMICILE_DISPLAY_REGIONS_H_
