// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_pointer_crossing.h"

#include <algorithm>

#include "base/check.h"
#include "ui/gfx/geometry/point_conversions.h"
#include "ui/gfx/geometry/size.h"

namespace ui {
namespace {

bool IsSideways(display::Display::Rotation rotation) {
  return rotation == display::Display::ROTATE_90 ||
         rotation == display::Display::ROTATE_270;
}

// The screen as the person sees it: the panel's size, turned.
gfx::Size UprightSize(const PointerScreen& screen) {
  const gfx::Size panel = screen.bounds_in_screen.size();
  return IsSideways(screen.rotation) ? gfx::Size(panel.height(), panel.width())
                                     : panel;
}

// A panel point, upright. The inverse of `ToPanel`, and turned the same way
// `CursorController::ApplyCursorConfigForWindow` turns a hand's motion, so a
// pointer leaves by the edge it was moving toward.
gfx::PointF ToUpright(const PointerScreen& screen, const gfx::PointF& panel) {
  const float width = static_cast<float>(screen.bounds_in_screen.width());
  const float height = static_cast<float>(screen.bounds_in_screen.height());
  switch (screen.rotation) {
    case display::Display::ROTATE_0:
      return panel;
    case display::Display::ROTATE_90:
      return gfx::PointF(panel.y(), width - panel.x());
    case display::Display::ROTATE_180:
      return gfx::PointF(width - panel.x(), height - panel.y());
    case display::Display::ROTATE_270:
      return gfx::PointF(height - panel.y(), panel.x());
  }
}

gfx::PointF ToPanel(const PointerScreen& screen, const gfx::PointF& upright) {
  const float width = static_cast<float>(screen.bounds_in_screen.width());
  const float height = static_cast<float>(screen.bounds_in_screen.height());
  switch (screen.rotation) {
    case display::Display::ROTATE_0:
      return upright;
    case display::Display::ROTATE_90:
      return gfx::PointF(width - upright.y(), upright.x());
    case display::Display::ROTATE_180:
      return gfx::PointF(width - upright.x(), height - upright.y());
    case display::Display::ROTATE_270:
      return gfx::PointF(upright.y(), height - upright.x());
  }
}

}  // namespace

std::optional<PointerCrossing> PointerCrossingFor(
    const std::vector<PointerScreen>& screens,
    gfx::AcceleratedWidget from,
    const gfx::PointF& location) {
  const auto on = std::ranges::find(screens, from, &PointerScreen::window);
  CHECK(on != screens.end());
  const gfx::PointF upright = ToUpright(*on, location);
  const float width = static_cast<float>(UprightSize(*on).width());
  const bool rightward = upright.x() >= width;
  if (!rightward && upright.x() >= 0) {
    return std::nullopt;
  }

  const auto beside =
      std::ranges::find_if(screens, [&](const PointerScreen& screen) {
        return rightward
                   ? screen.bounds_in_screen.x() == on->bounds_in_screen.right()
                   : screen.bounds_in_screen.right() ==
                         on->bounds_in_screen.x();
      });
  if (beside == screens.end()) {
    return std::nullopt;
  }

  const float across =
      rightward
          ? upright.x() - width
          : static_cast<float>(UprightSize(*beside).width()) + upright.x();
  return PointerCrossing{beside->window,
                         ToPanel(*beside, gfx::PointF(across, upright.y()))};
}

bool HasTheKeyboard(const gfx::Rect& bounds_in_screen,
                    const gfx::PointF& pointer) {
  return bounds_in_screen.Contains(gfx::ToFlooredPoint(pointer));
}

}  // namespace ui
