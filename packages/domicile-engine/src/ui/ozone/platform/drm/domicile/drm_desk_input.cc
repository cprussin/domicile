// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_desk_input.h"

#include <cmath>

#include "ui/events/event_constants.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/ozone/public/system_input_injector.h"

namespace ui {

namespace {

// The flag for evdev button `code`, or EF_NONE for none a mouse has.
EventFlags ButtonFlag(uint32_t code) {
  switch (code) {
    case 0x110:  // BTN_LEFT
      return EF_LEFT_MOUSE_BUTTON;
    case 0x111:  // BTN_RIGHT
      return EF_RIGHT_MOUSE_BUTTON;
    case 0x112:  // BTN_MIDDLE
      return EF_MIDDLE_MOUSE_BUTTON;
    case 0x113:  // BTN_SIDE
      return EF_BACK_MOUSE_BUTTON;
    case 0x114:  // BTN_EXTRA
      return EF_FORWARD_MOUSE_BUTTON;
    default:
      return EF_NONE;
  }
}

// Chrome's wheel offset for one detent, and the pixels the compositor scrolls
// for it.
constexpr double kWheelPerDetent = 120;
constexpr double kPixelsPerDetent = 15;

// Chrome scrolls up and left for a positive offset.
int WheelOffset(double pixels) {
  return static_cast<int>(
      std::lround(-pixels * kWheelPerDetent / kPixelsPerDetent));
}

}  // namespace

void InjectDeskInput(SystemInputInjector& injector,
                     const DomicileDeskInput& input) {
  switch (input.kind) {
    case DomicileDeskInput::Kind::kPointer:
      injector.MoveCursorTo(gfx::PointF(input.x, input.y));
      return;
    case DomicileDeskInput::Kind::kButton:
      if (const EventFlags button = ButtonFlag(input.code); button != EF_NONE) {
        injector.InjectMouseButton(button, input.pressed);
      }
      return;
    case DomicileDeskInput::Kind::kScroll:
      injector.InjectMouseWheel(WheelOffset(input.x), WheelOffset(input.y));
      return;
    case DomicileDeskInput::Kind::kKey:
      if (const DomCode key = KeycodeConverter::EvdevCodeToDomCode(
              static_cast<int>(input.code));
          key != DomCode::NONE) {
        injector.InjectKeyEvent(key, input.pressed,
                                /*suppress_auto_repeat=*/true);
      }
      return;
  }
}

}  // namespace ui
