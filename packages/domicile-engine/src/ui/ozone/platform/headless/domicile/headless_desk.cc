// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/headless/domicile/headless_desk.h"

#include <stdint.h>

#include <algorithm>
#include <limits>
#include <vector>

#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "ui/gfx/display_color_spaces.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"

namespace ui {
namespace {

// Returns `layout`'s entry for display `id`, or `nullptr` if it has none.
const DomicileDisplayLayout* WantedFor(
    const std::vector<DomicileDisplayLayout>& layout,
    int64_t id) {
  const auto found = std::ranges::find(layout, id, &DomicileDisplayLayout::id);
  return found == layout.end() ? nullptr : &*found;
}

// The right edge of every display `layout` places among `virtuals`.
int PlacedRightEdge(const std::vector<DomicileVirtualDisplay>& virtuals,
                    const std::vector<DomicileDisplayLayout>& layout) {
  int right = 0;
  for (const DomicileVirtualDisplay& one : virtuals) {
    if (const DomicileDisplayLayout* wanted = WantedFor(layout, one.id)) {
      right = std::max(right, wanted->origin.x() + one.mode.width());
    }
  }
  return right;
}

}  // namespace

HeadlessDesk HeadlessDeskOf(
    const display::Display& placeholder,
    const std::vector<DomicileVirtualDisplay>& virtuals,
    const std::vector<DomicileDisplayLayout>& layout) {
  HeadlessDesk desk;
  if (virtuals.empty()) {
    desk.displays.push_back(placeholder);
    desk.connectors[placeholder.id()] = kHeadlessPlaceholderConnector;
    return desk;
  }
  int next_x = PlacedRightEdge(virtuals, layout);
  for (const DomicileVirtualDisplay& one : virtuals) {
    const DomicileDisplayLayout* wanted = WantedFor(layout, one.id);
    const gfx::Point origin =
        wanted != nullptr ? wanted->origin : gfx::Point(next_x, 0);
    if (wanted == nullptr) {
      next_x += one.mode.width();
    }
    // Not named `display`, which would shadow the namespace.
    display::Display screen(one.id, gfx::Rect(origin, one.mode));
    screen.set_display_frequency(static_cast<float>(one.refresh_mhz) /
                                 1000.f);
    screen.set_label(one.name);
    if (wanted != nullptr) {
      // As DRM's `TurnAndScale`: the bounds stay pixels, and the window lays
      // its page out at the scale.
      screen.set_device_scale_factor(static_cast<float>(wanted->scale));
      screen.set_size_in_pixels(one.mode);
    }
    desk.displays.push_back(screen);
    desk.connectors[one.id] = base::StrCat(
        {"virtual-",
         base::NumberToString(one.id & std::numeric_limits<int64_t>::max())});
  }
  return desk;
}

}  // namespace ui
