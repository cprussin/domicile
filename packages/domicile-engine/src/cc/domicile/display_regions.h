// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CC_DOMICILE_DISPLAY_REGIONS_H_
#define CC_DOMICILE_DISPLAY_REGIONS_H_

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

// The ratios of the regions `rect_in_target` meets, each once, ascending.
std::vector<float> DomicileRatiosMeeting(const DomicileDisplayRegions& regions,
                                         const gfx::Rect& rect_in_target);

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
