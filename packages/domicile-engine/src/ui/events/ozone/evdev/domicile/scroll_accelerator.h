// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_ACCELERATOR_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_ACCELERATOR_H_

#include <optional>

#include "base/component_export.h"
#include "base/time/time.h"
#include "ui/gfx/geometry/vector2d.h"
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
  // Returns the whole units to dispatch for libinput's `delta`, in Chromium's
  // sign. Carries the fraction to the next event, because a slow finger moves
  // less than a unit per event.
  gfx::Vector2d Scroll(const gfx::Vector2dF& delta, base::TimeTicks time);

 private:
  std::optional<base::TimeTicks> last_;
  gfx::Vector2dF remainder_;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_ACCELERATOR_H_
