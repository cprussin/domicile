// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/scroll_accelerator.h"

#include <algorithm>
#include <limits>
#include <optional>

#include "ui/events/ozone/evdev/domicile/scroll_factor.h"
#include "ui/gfx/geometry/vector2d.h"

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

void ScrollAccelerator::Configure(bool acceleration, double factor) {
  if (acceleration_ != acceleration || factor_ != factor) {
    acceleration_ = acceleration;
    factor_ = factor;
    Stop(true, true);
  }
}

gfx::Vector2dF ScrollAccelerator::Scroll(const gfx::Vector2dF& delta,
                                         base::TimeTicks time) {
  if (delta.IsZero()) {
    Stop(true, true);
    return gfx::Vector2dF();
  }

  active_x_ = active_x_ || delta.x() != 0;
  active_y_ = active_y_ || delta.y() != 0;
  if (!acceleration_) {
    return gfx::Vector2dF(ScaleScrollAxis(delta.x(), factor_),
                          ScaleScrollAxis(delta.y(), factor_));
  }
  const double gain = Gain(delta, last_, time);
  // Keep whole-pixel acceleration and saturate before the integer conversion,
  // including when a finite user factor overflows multiplication.
  const double x =
      std::clamp(remainder_x_ + delta.x() * gain * factor_,
                 static_cast<double>(std::numeric_limits<int>::min()),
                 static_cast<double>(std::numeric_limits<int>::max()));
  const double y =
      std::clamp(remainder_y_ + delta.y() * gain * factor_,
                 static_cast<double>(std::numeric_limits<int>::min()),
                 static_cast<double>(std::numeric_limits<int>::max()));
  last_ = time;
  const gfx::Vector2d whole(static_cast<int>(x), static_cast<int>(y));
  remainder_x_ = x - whole.x();
  remainder_y_ = y - whole.y();
  return gfx::Vector2dF(whole);
}

void ScrollAccelerator::Stop(bool horizontal, bool vertical) {
  if (horizontal) {
    remainder_x_ = 0;
    active_x_ = false;
  }
  if (vertical) {
    remainder_y_ = 0;
    active_y_ = false;
  }
  if (!active_x_ && !active_y_) {
    last_.reset();
  }
}

}  // namespace ui
