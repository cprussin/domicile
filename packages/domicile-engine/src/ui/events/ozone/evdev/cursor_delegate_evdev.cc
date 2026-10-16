// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/cursor_delegate_evdev.h"

#include "ui/gfx/geometry/rect.h"

namespace ui {

// Out of line: the style plugin refuses a virtual with an inline body.
gfx::Rect CursorDelegateEvdev::GetDomicileAbsoluteArea(int device_id) {
  return GetCursorConfinedBounds();
}

}  // namespace ui
