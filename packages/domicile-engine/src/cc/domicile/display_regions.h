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

// One monitor's part of a page that is shown on several, each at its own
// density.
//
// A NATIVE PIXEL ON EVERY MONITOR. On a tty the desk is one page, rastered at
// the densest monitor's scale and shown on every monitor -- each scaling it to
// its own (see docs/architecture/ONE-PAGE-FOR-THE-DESK.md). Left there, a 1x
// monitor beside a 2x one shows text rastered at 2 and shrunk by half. So a
// layer that a less dense monitor shows also keeps a tiling at that monitor's
// scale, and draws its quads there from it: viz's shrink then lands every one
// of its texels on one of the monitor's pixels.
struct DomicileDisplayRegion {
  // In the page's viewport, in device pixels at the page's scale.
  gfx::Rect rect;
  // The monitor's scale over the page's, in (0, 1). A monitor as dense as the
  // page is not a region: it shows the page's own tiles.
  float ratio = 1.f;

  friend bool operator==(const DomicileDisplayRegion&,
                         const DomicileDisplayRegion&) = default;
};

using DomicileDisplayRegions = std::vector<DomicileDisplayRegion>;

// What labels a monitor among a page's screens as one it is shown on, rather
// than one the screen the page is told it is on is. The browser puts one such
// screen in a desk page's ScreenInfos per lit monitor, and a widget makes its
// regions from them.
inline constexpr char kDomicileDisplayLabel[] = "domicile-display";

// A monitor a page is shown on: where, on the screen the page's widget is
// placed on, in DIPs; and how dense.
struct DomicileDisplay {
  gfx::Rect rect;
  float scale = 1.f;
};

// The regions of a widget at `widget_origin` on that screen, rastered at
// `page_scale`: every monitor less dense than it, in its device pixels.
DomicileDisplayRegions DomicileDisplayRegionsOf(
    const std::vector<DomicileDisplay>& displays,
    const gfx::Point& widget_origin,
    float page_scale);

// The tile memory a widget at `widget_rect` on that screen, rastered at
// `page_scale`, needs, at most `ceiling_bytes`; 0 when it is shown on no
// monitor. Upstream sizes the budget from the screen the widget starts on, a
// fraction of the desk, and a page over budget draws its tiles as solid color.
// So this is every pixel of the page and of each monitor's tiling, with room
// for several layers that big and their pending twins.
size_t DomicileTileBytesFor(const std::vector<DomicileDisplay>& displays,
                            const gfx::Rect& widget_rect,
                            float page_scale,
                            size_t ceiling_bytes);

// How many monitors' tilings a layer keeps at most: the raster queue has an
// iterator for each (TilingSetRasterQueueAll's DOMICILE_DISPLAY_*), and a
// tiling activation waits on but that is never rastered would hold the page
// up.
inline constexpr size_t kDomicileMostDisplayTilings = 3;

// The ratios of the regions `rect_in_target` meets, each once, ascending: the
// least dense kDomicileMostDisplayTilings, whose monitors shrink the page's
// own tiles the most.
std::vector<float> DomicileRatiosMeeting(const DomicileDisplayRegions& regions,
                                         const gfx::Rect& rect_in_target);

// What of a layer decides whether it has a tiling for each monitor it is on.
struct DomicileLayer {
  // From the layer into the page's viewport. Its regions are found through
  // this, so only a scale and a translation can find them.
  bool to_page_is_scale_or_translation = false;
  // Drawn straight into the page by a scale and a translation, rather than
  // into a surface of its own that is then drawn into the page at the page's
  // scale.
  bool draws_into_page = false;
  // Drawn at the image's own scale, whatever the page's.
  bool is_directly_composited_image = false;
};

// Whether `layer` keeps a tiling for each monitor it is on, rastered on both
// trees. It does through a surface of its own, which it cannot draw from them
// through: a tiling given up there comes back empty, and until it is rastered
// again its monitor shows the page's tiles, shrunk, then its own -- a flash.
bool DomicileKeepsDisplayTilings(const DomicileLayer& layer);

// Whether `layer` draws each monitor's part from that monitor's tiling.
bool DomicileDrawsFromDisplayTilings(const DomicileLayer& layer);

// Around every region of `ratio`, in the space `to_target` maps from -- a
// layer's own. Empty unless `to_target` is a scale and a translation: a
// turned layer is drawn from its own tiles everywhere.
gfx::Rect DomicileRegionInLayer(const DomicileDisplayRegions& regions,
                                float ratio,
                                const gfx::Transform& to_target);

// A part of what a layer draws, and which tiling it is drawn from: the one at
// the layer's scale times `ratio`.
struct DomicileCoveragePiece {
  gfx::Rect rect;
  float ratio = 1.f;
};

// `visible`, in the space `to_target` maps from, cut along the regions: each
// region's part at its ratio, then the rest at 1. Apart and together exactly
// `visible`, so no quad is drawn twice. Where two regions overlap -- monitors
// mirrored -- the first has it. All of `visible` at 1 unless `to_target` is a
// scale and a translation.
std::vector<DomicileCoveragePiece> DomicileCoverage(
    const DomicileDisplayRegions& regions,
    const gfx::Transform& to_target,
    const gfx::Rect& visible);

}  // namespace cc

#endif  // CC_DOMICILE_DISPLAY_REGIONS_H_
