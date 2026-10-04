// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_WHEEL_TICKS_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_WHEEL_TICKS_H_

#include "base/component_export.h"
#include "ui/gfx/geometry/vector2d.h"

namespace ui {

// Converts libinput wheel clicks to `MouseWheelEvent` units (120 per notch).
//
// Takes libinput's discrete values, whole clicks only. libinput's sign is the
// reverse of Chromium's: a click down is +1 there and -120 here.
COMPONENT_EXPORT(EVDEV)
gfx::Vector2d WheelTicks(double horizontal_clicks, double vertical_clicks);

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_WHEEL_TICKS_H_
