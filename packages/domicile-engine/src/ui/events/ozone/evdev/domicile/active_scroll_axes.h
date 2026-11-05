// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_ACTIVE_SCROLL_AXES_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_ACTIVE_SCROLL_AXES_H_

#include <array>
#include <optional>

#include "ui/events/domicile/scroll_metadata.h"

namespace ui {

// Retains the stops a device owes its native clients when it is disabled.
class ActiveScrollAxes {
 public:
  void Observe(NativeScrollSource source,
               bool moved_x,
               bool moved_y,
               bool stop_x,
               bool stop_y) {
    if (source == NativeScrollSource::kWheel ||
        source == NativeScrollSource::kWheelTilt) {
      return;
    }
    source_ = source;
    active_x_ = !stop_x && (active_x_ || moved_x);
    active_y_ = !stop_y && (active_y_ || moved_y);
  }

  std::optional<NativeScrollMetadata> TakeStop() {
    if (!active_x_ && !active_y_) {
      return std::nullopt;
    }
    const NativeScrollMetadata stop{source_, active_x_, active_y_,
                                    std::array<double, 2>{0, 0}};
    active_x_ = false;
    active_y_ = false;
    return stop;
  }

 private:
  NativeScrollSource source_ = NativeScrollSource::kFinger;
  bool active_x_ = false;
  bool active_y_ = false;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_ACTIVE_SCROLL_AXES_H_
