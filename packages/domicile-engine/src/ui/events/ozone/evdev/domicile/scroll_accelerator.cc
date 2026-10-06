// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/scroll_accelerator.h"

#include <algorithm>
#include <optional>

namespace ui {

namespace {

// Speeds are in libinput units per millisecond. A unit is about 0.1 mm of
// finger travel, so the threshold is about 5 cm/s: slower is reading, faster
// is moving through the page.
constexpr double kThreshold = 0.5;
// Gain added per unit/ms above the threshold.
constexpr double kSlope = 1.5;
// Reached at 2.5 units/ms, a brisk flick.
constexpr double kMaxGain = 4.0;
// Longer than any pad's report interval, shorter than a person pausing.
constexpr base::TimeDelta kGestureGap = base::Milliseconds(100);
// Floor on the interval between reports, so close reports don't spike the
// speed.
constexpr double kMinIntervalMs = 1.0;

// Returns 1 for the first event of a gesture, which has no speed yet.
float Gain(const gfx::Vector2dF& delta,
           std::optional<base::TimeTicks> last,
           base::TimeTicks time) {
  if (!last || time - *last > kGestureGap) {
    return 1.0f;
  }
  const double interval_ms =
      std::max((time - *last).InMillisecondsF(), kMinIntervalMs);
  const double speed = delta.Length() / interval_ms;
  return static_cast<float>(
      std::clamp(1.0 + kSlope * (speed - kThreshold), 1.0, kMaxGain));
}

}  // namespace

gfx::Vector2d ScrollAccelerator::Scroll(const gfx::Vector2dF& delta,
                                        base::TimeTicks time) {
  if (delta.IsZero()) {
    last_.reset();
    remainder_ = gfx::Vector2dF();
    return gfx::Vector2d();
  }

  remainder_ += gfx::ScaleVector2d(delta, Gain(delta, last_, time));
  last_ = time;

  // Truncate toward zero; the fraction carries to the next event.
  const gfx::Vector2d whole(static_cast<int>(remainder_.x()),
                            static_cast<int>(remainder_.y()));
  remainder_ -= gfx::Vector2dF(static_cast<float>(whole.x()),
                               static_cast<float>(whole.y()));
  return whole;
}

}  // namespace ui
