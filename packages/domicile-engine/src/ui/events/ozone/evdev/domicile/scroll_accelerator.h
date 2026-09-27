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

// Two-finger scrolling that goes further the faster the fingers move.
//
// libinput accelerates pointer motion and never scroll: a touchpad's scroll
// is the finger's distance times a constant, so the distance a page moves is
// the distance the fingers do, however they move. Across a long page that is
// a dozen swipes. This is the pointer's curve applied to scroll -- slow is
// one to one, so reading a line at a time is untouched, and fast is up to
// four times further.
//
// One per converter, fed every finger-scroll event in order. A gesture starts
// over at libinput's scroll stop (a zero delta) or after a pause, so a flick
// never borrows the speed of the one before it.
class COMPONENT_EXPORT(EVDEV) ScrollAccelerator {
 public:
  // `delta` is libinput's, in Chromium's sign. Returns the whole units to
  // dispatch; the fraction is carried to the next event rather than dropped,
  // because a slow finger moves less than a unit per event.
  gfx::Vector2d Scroll(const gfx::Vector2dF& delta, base::TimeTicks time);

 private:
  std::optional<base::TimeTicks> last_;
  gfx::Vector2dF remainder_;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_SCROLL_ACCELERATOR_H_
