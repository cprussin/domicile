// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_ACCELERATOR_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_ACCELERATOR_H_

#include <optional>

#include "base/component_export.h"
#include "base/time/time.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace ui {

// Accelerates two-finger touchpad scrolling by finger speed.
//
// libinput accelerates pointer motion but not scrolling, so a long page takes
// many swipes. Slow scrolling stays 1:1; fast scrolling goes up to 4x.
//
// Use one per converter and feed it every finger-scroll event in order. A
// zero delta (libinput's scroll stop) or a pause starts a new gesture, so one
// flick's speed never carries into the next.
class COMPONENT_EXPORT(EVDEV) ScrollAccelerator {
 public:
  void Configure(bool acceleration, double factor);
  // Linear scrolling preserves subpixel distance. Accelerated scrolling carries
  // fractional units to the next event, preserving its whole-pixel behavior.
  gfx::Vector2dF Scroll(const gfx::Vector2dF& delta, base::TimeTicks time);
  void Stop(bool horizontal, bool vertical);

 private:
  bool acceleration_ = true;
  double factor_ = 1;
  std::optional<base::TimeTicks> last_;
  double remainder_x_ = 0;
  double remainder_y_ = 0;
  bool active_x_ = false;
  bool active_y_ = false;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_ACCELERATOR_H_
