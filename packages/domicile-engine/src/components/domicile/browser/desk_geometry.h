// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_GEOMETRY_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_GEOMETRY_H_

#include <stdint.h>

#include <optional>
#include <vector>

#include "ui/display/screen_info.h"
#include "ui/display/screen_infos.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {

// One lit display and its position on the desk, from the display profile.
//
// On a tty the shell is one page spanning every display. See
// docs/architecture/ONE-PAGE-FOR-THE-DESK.md.
struct DeskPlace {
  int64_t id = 0;
  // The profile's `desk` rectangle, in desk logical pixels.
  gfx::Rect desk;
  float scale = 1.0f;
  float refresh_hz = 0.0f;
};

// The shell page that spans the desk.
struct DeskGeometry {
  // Bounds of all displays in desk logical pixels; the page's viewport.
  gfx::Rect box;
  // The largest display scale, which the page lays out and rasters at.
  float scale = 1.0f;
  // The display whose window loads the page. The fastest one, since its
  // BeginFrames drive the page; ties go to the first (the primary).
  int64_t host = 0;
};

// The desk page's geometry, or `std::nullopt` if no display is lit.
std::optional<DeskGeometry> DeskGeometryOf(const std::vector<DeskPlace>& lit);

// The page's bounds in `place`'s logical pixels, which its window's layers use.
gfx::Rect PageBoundsOn(const DeskPlace& place, const gfx::Rect& box);

// The screens reported to the page. The first is one upright screen the size
// of the desk at the desk's scale, with other fields copied from `like`.
//
// Then one entry per monitor in `lit`, offset from the desk's corner at its
// own scale and labeled `cc::kDomicileDisplayLabel`. The widget uses these to
// raster each monitor's region natively.
display::ScreenInfos DeskScreenInfos(const DeskGeometry& desk,
                                     const std::vector<DeskPlace>& lit,
                                     const display::ScreenInfo& like);

// The display in `lit` containing `at` (in `host`'s logical pixels), or `host`
// if none does. `std::nullopt` if `host` is not on the desk.
//
// Needed because the cursor is drawn for its monitor's rotation and scale. A
// warp goes through the host (`PointerCrossingFor`), and aura only redraws the
// cursor when it changes monitors, so the caller must say where it landed.
std::optional<int64_t> WarpLandsOn(const std::vector<DeskPlace>& lit,
                                   int64_t host,
                                   const gfx::Point& at);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_GEOMETRY_H_
