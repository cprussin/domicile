// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_geometry.h"

#include <algorithm>

#include "cc/domicile/display_regions.h"
#include "ui/display/mojom/screen_orientation.mojom-shared.h"

namespace domicile {

std::vector<DeskPlace> DeskPlacesKept(
    const std::optional<std::vector<DeskPlace>>& lit,
    const std::vector<DeskPlace>& before,
    const std::vector<display::Display>& displays) {
  if (!lit.has_value()) {
    std::vector<DeskPlace> placed;
    placed.reserve(displays.size());
    for (const display::Display& display : displays) {
      placed.push_back(DeskPlace{.id = display.id(),
                                 .desk = display.bounds(),
                                 .scale = 1.0f,
                                 .refresh_hz = display.display_frequency()});
    }
    return placed;
  }
  if (!lit->empty()) {
    return *lit;
  }
  std::vector<DeskPlace> kept = before;
  std::erase_if(kept, [&displays](const DeskPlace& place) {
    return !std::ranges::contains(displays, place.id, &display::Display::id);
  });
  return kept;
}

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

gfx::Rect PopupBoundsOn(const gfx::Rect& popup,
                        const gfx::Rect& page_on_host,
                        const gfx::Rect& page_on_display) {
  return popup + (page_on_display.origin() - page_on_host.origin());
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

display::ScreenInfos PopupScreenInfos(display::ScreenInfos infos,
                                      const gfx::Rect& popup) {
  const display::ScreenInfo* on = nullptr;
  int overlap = 0;
  for (const display::ScreenInfo& monitor : infos.screen_infos) {
    if (monitor.label != cc::kDomicileDisplayLabel) {
      continue;
    }
    if (monitor.rect.Contains(popup.origin())) {
      on = &monitor;
      break;
    }
    gfx::Rect shared = monitor.rect;
    shared.Intersect(popup);
    const int area = shared.width() * shared.height();
    if (area > overlap) {
      overlap = area;
      on = &monitor;
    }
  }
  if (on == nullptr) {
    return infos;
  }
  const gfx::Rect rect = on->rect;
  const gfx::Rect available_rect = on->available_rect;
  display::ScreenInfo& current = infos.mutable_current();
  current.rect = rect;
  current.available_rect = available_rect;
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
