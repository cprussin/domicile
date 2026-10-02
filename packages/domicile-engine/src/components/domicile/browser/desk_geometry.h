// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_GEOMETRY_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_GEOMETRY_H_

#include <stdint.h>

#include <optional>
#include <vector>

#include "ui/display/screen_info.h"
#include "ui/display/screen_infos.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {

// One lit display, where the profile put it on the desk.
//
// See docs/architecture/ONE-PAGE-FOR-THE-DESK.md: on a tty the shell is one
// page over the whole desk, and every display shows its part of it.
struct DeskPlace {
  int64_t id = 0;
  // In the desk's logical pixels, as the profile's `desk` rectangle.
  gfx::Rect desk;
  float scale = 1.0f;
  float refresh_hz = 0.0f;
};

// The one page a desk is.
struct DeskGeometry {
  // Around every display, in the desk's logical pixels. The page's viewport.
  gfx::Rect box;
  // The largest display scale: what the page lays out and rasters at.
  float scale = 1.0f;
  // The display whose window loads the page: the fastest, because its
  // BeginFrames drive the page. The first of equals, which is the primary.
  int64_t host = 0;
};

// `std::nullopt` for a desk with no display lit.
std::optional<DeskGeometry> DeskGeometryOf(const std::vector<DeskPlace>& lit);

// Where the page sits in `place`'s logical pixels, which are what that
// display's window lays its layers out in.
gfx::Rect PageBoundsOn(const DeskPlace& place, const gfx::Rect& box);

// What the page is told it is on: one screen, the size of the desk, at the
// desk's scale and upright. Everything else -- depth, color space -- is `like`,
// the host display's.
//
// And every monitor in `lit` it is shown on, after that one: where, from the
// desk's corner, and how dense. Labeled `cc::kDomicileDisplayLabel`, which is
// what a widget makes the regions it rasters natively for each from.
display::ScreenInfos DeskScreenInfos(const DeskGeometry& desk,
                                     const std::vector<DeskPlace>& lit,
                                     const display::ScreenInfo& like);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_GEOMETRY_H_
