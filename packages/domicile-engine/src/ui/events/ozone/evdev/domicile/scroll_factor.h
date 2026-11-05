// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_FACTOR_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_FACTOR_H_

#include <algorithm>
#include <limits>

namespace ui {

// Saturate finite user factors before an overflowing product reaches events.
inline double ScaleScrollAxis(double distance, double factor) {
  return std::clamp(distance * factor,
                    static_cast<double>(std::numeric_limits<int>::min()),
                    static_cast<double>(std::numeric_limits<int>::max()));
}

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_FACTOR_H_
