// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/wheel_ticks.h"

#include "base/numerics/safe_conversions.h"
#include "ui/events/event.h"

namespace ui {

gfx::Vector2d WheelTicks(const double horizontal_clicks,
                         const double vertical_clicks) {
  return gfx::Vector2d(
      base::ClampRound(-horizontal_clicks * MouseWheelEvent::kWheelDelta),
      base::ClampRound(-vertical_clicks * MouseWheelEvent::kWheelDelta));
}

}  // namespace ui
