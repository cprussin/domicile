// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/headless/domicile/headless_desk_input.h"

#include <cmath>
#include <utility>

#include "base/time/time.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "ui/events/keycodes/keyboard_code_conversion.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/events/ozone/layout/keyboard_layout_engine.h"
#include "ui/gfx/geometry/vector2d.h"

namespace ui {

namespace {

// The flag for evdev button `code`, or 0 for none a mouse has.
int ButtonFlag(uint32_t code) {
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
      return 0;
  }
}

// Chrome's wheel offset for one detent, and the pixels the compositor scrolls
// for it.
constexpr double kWheelPerDetent = 120;
constexpr double kPixelsPerDetent = 15;

}  // namespace

HeadlessDeskInput::HeadlessDeskInput(Deliver deliver,
                                     const KeyboardLayoutEngine* layout)
    : deliver_(std::move(deliver)), layout_(layout) {}

HeadlessDeskInput::~HeadlessDeskInput() = default;

void HeadlessDeskInput::Inject(const DomicileDeskInput& input) {
  switch (input.kind) {
    case DomicileDeskInput::Kind::kPointer:
      MovePointer(gfx::PointF(input.x, input.y));
      return;
    case DomicileDeskInput::Kind::kButton:
      PressButton(input.code, input.pressed);
      return;
    case DomicileDeskInput::Kind::kScroll:
      Scroll(input.x, input.y);
      return;
    case DomicileDeskInput::Kind::kKey:
      PressKey(input.code, input.pressed);
      return;
  }
}

void HeadlessDeskInput::MovePointer(const gfx::PointF& to) {
  pointer_ = to;
  MouseEvent event(buttons_ ? EventType::kMouseDragged : EventType::kMouseMoved,
                   pointer_, pointer_, base::TimeTicks::Now(),
                   buttons_ | modifiers_, 0);
  deliver_.Run(&event);
}

void HeadlessDeskInput::PressButton(uint32_t code, bool pressed) {
  const int button = ButtonFlag(code);
  if (!button) {
    return;
  }
  // A release still carries its button, as Chrome's own events do.
  const int flags = buttons_ | button | modifiers_;
  if (pressed) {
    buttons_ |= button;
  } else {
    buttons_ &= ~button;
  }
  MouseEvent event(
      pressed ? EventType::kMousePressed : EventType::kMouseReleased, pointer_,
      pointer_, base::TimeTicks::Now(), flags, button);
  deliver_.Run(&event);
}

void HeadlessDeskInput::Scroll(double x, double y) {
  // Chrome scrolls up and left for a positive offset.
  const gfx::Vector2d offset(
      static_cast<int>(std::lround(-x * kWheelPerDetent / kPixelsPerDetent)),
      static_cast<int>(std::lround(-y * kWheelPerDetent / kPixelsPerDetent)));
  MouseWheelEvent event(offset, pointer_, pointer_, base::TimeTicks::Now(),
                        buttons_ | modifiers_, 0);
  deliver_.Run(&event);
}

void HeadlessDeskInput::PressKey(uint32_t code, bool pressed) {
  const DomCode dom_code =
      KeycodeConverter::EvdevCodeToDomCode(static_cast<int>(code));
  if (dom_code == DomCode::NONE) {
    return;
  }
  DomKey dom_key;
  KeyboardCode key_code;
  if (!layout_->Lookup(dom_code, modifiers_, &dom_key, &key_code)) {
    return;
  }
  // Caps Lock turns on or off with each press; any other modifier is held.
  const int modifier = ModifierDomKeyToEventFlag(dom_key);
  if (modifier == EF_CAPS_LOCK_ON) {
    if (pressed) {
      modifiers_ ^= modifier;
    }
  } else if (pressed) {
    modifiers_ |= modifier;
  } else {
    modifiers_ &= ~modifier;
  }
  KeyEvent event(pressed ? EventType::kKeyPressed : EventType::kKeyReleased,
                 key_code, dom_code, modifiers_ | buttons_, dom_key,
                 base::TimeTicks::Now());
  deliver_.Run(&event);
}

}  // namespace ui
