// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_geometry.h"

#include <algorithm>

#include "cc/domicile/display_regions.h"
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
    // Strictly faster, so ties keep the first.
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
                                     const std::vector<DeskPlace>& lit,
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
  display::ScreenInfos infos(told);
  // ScreenInfos needs unique ids and the host's is taken. Real display ids
  // are never negative.
  int64_t id = -1000;
  for (const DeskPlace& place : lit) {
    display::ScreenInfo shown;
    shown.rect = place.desk - desk.box.OffsetFromOrigin();
    shown.available_rect = shown.rect;
    shown.device_scale_factor = place.scale;
    shown.display_id = id--;
    shown.label = cc::kDomicileDisplayLabel;
    infos.screen_infos.push_back(shown);
  }
  return infos;
}

std::optional<int64_t> WarpLandsOn(const std::vector<DeskPlace>& lit,
                                   int64_t host,
                                   const gfx::Point& at) {
  const auto on = std::ranges::find(lit, host, &DeskPlace::id);
  if (on == lit.end()) {
    return std::nullopt;
  }
  const gfx::Point on_the_desk = at + on->desk.OffsetFromOrigin();
  const auto there = std::ranges::find_if(lit, [&](const DeskPlace& place) {
    return place.desk.Contains(on_the_desk);
  });
  return there == lit.end() ? host : there->id;
}

}  // namespace domicile
