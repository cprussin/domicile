// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_geometry.h"

#include <algorithm>

#include "ui/display/mojom/screen_orientation.mojom-shared.h"

namespace domicile {

std::optional<DeskGeometry> DeskGeometryOf(const std::vector<DeskPlace>& lit) {
  if (lit.empty()) {
    return std::nullopt;
  }
  DeskGeometry desk{.box = lit.front().desk,
                    .scale = lit.front().scale,
                    .host = lit.front().id};
  float fastest = lit.front().refresh_hz;
  for (const DeskPlace& place : lit) {
    desk.box.Union(place.desk);
    desk.scale = std::max(desk.scale, place.scale);
    // Strictly faster, so the first of equals keeps it.
    if (place.refresh_hz > fastest) {
      fastest = place.refresh_hz;
      desk.host = place.id;
    }
  }
  return desk;
}

gfx::Rect PageBoundsOn(const DeskPlace& place, const gfx::Rect& box) {
  return gfx::Rect(box.origin() - place.desk.OffsetFromOrigin(), box.size());
}

display::ScreenInfos DeskScreenInfos(const DeskGeometry& desk,
                                     const display::ScreenInfo& like) {
  display::ScreenInfo told = like;
  told.rect = gfx::Rect(desk.box.size());
  told.available_rect = told.rect;
  told.device_scale_factor = desk.scale;
  told.display_id = desk.host;
  told.orientation_angle = 0;
  told.orientation_type =
      desk.box.width() >= desk.box.height()
          ? display::mojom::ScreenOrientation::kLandscapePrimary
          : display::mojom::ScreenOrientation::kPortraitPrimary;
  return display::ScreenInfos(told);
}

}  // namespace domicile
