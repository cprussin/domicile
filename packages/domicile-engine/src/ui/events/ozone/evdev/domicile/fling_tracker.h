// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_FLING_TRACKER_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_FLING_TRACKER_H_

#include "base/component_export.h"
#include "base/containers/circular_deque.h"
#include "base/time/time.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace ui {

// Measures how fast two fingers were scrolling when they lifted, so a page
// keeps gliding at that speed. libinput reports the lift as a scroll stop and
// leaves momentum to whoever draws the content.
class COMPONENT_EXPORT(EVDEV) FlingTracker {
 public:
  FlingTracker();
  FlingTracker(const FlingTracker&) = delete;
  FlingTracker& operator=(const FlingTracker&) = delete;
  ~FlingTracker();

  // Records a scroll distance dispatched at `time`.
  void Scroll(const gfx::Vector2dF& delta, base::TimeTicks time);
  // Returns the speed, in units per second, just before the lift at `time`,
  // and forgets the gesture. Zero when the fingers rested before lifting.
  gfx::Vector2dF Release(base::TimeTicks time);

 private:
  struct Sample {
    gfx::Vector2dF delta;
    base::TimeTicks time;
  };
  base::circular_deque<Sample> samples_;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_FLING_TRACKER_H_
