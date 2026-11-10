// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/pointer_hiding.h"

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/gesture_event_details.h"
#include "ui/events/keycodes/keyboard_codes.h"

namespace domicile {
namespace {

// Whether `key` is typing: a press, not repeated, of a key that is not a
// modifier, a function key, or a media, volume, brightness or power key,
// without Ctrl, Alt or Super held. Ash's `ShouldHideCursorOnKeyEvent`
// without its ChromeOS checks.
bool IsTyping(const ui::KeyEvent& key) {
  if (key.type() != ui::EventType::kKeyPressed || key.is_repeat() ||
      key.IsControlDown() || key.IsAltDown() || key.IsCommandDown()) {
    return false;
  }
  const ui::KeyboardCode code = key.key_code();
  if ((code >= ui::VKEY_F1 && code <= ui::VKEY_F24) ||
      (code >= ui::VKEY_BROWSER_BACK && code <= ui::VKEY_MEDIA_LAUNCH_APP2)) {
    return false;
  }
  switch (code) {
    case ui::VKEY_SHIFT:
    case ui::VKEY_CONTROL:
    case ui::VKEY_MENU:
    case ui::VKEY_LWIN:
    case ui::VKEY_RWIN:
    case ui::VKEY_ALTGR:
    case ui::VKEY_CAPITAL:
    case ui::VKEY_WLAN:
    case ui::VKEY_POWER:
    case ui::VKEY_SLEEP:
    case ui::VKEY_BRIGHTNESS_DOWN:
    case ui::VKEY_BRIGHTNESS_UP:
    case ui::VKEY_KBD_BRIGHTNESS_DOWN:
    case ui::VKEY_KBD_BRIGHTNESS_UP:
    case ui::VKEY_PRIVACY_SCREEN_TOGGLE:
    case ui::VKEY_ZOOM:
      return false;
    default:
      return true;
  }
}

// Whether `event` is somebody using the pointer. A touchscreen is not the
// pointer, and a move aura synthesized is nobody.
bool IsPointerInput(const ui::Event& event) {
  if (event.IsGestureEvent()) {
    return event.AsGestureEvent()->details().device_type() ==
           ui::GestureDeviceType::DEVICE_TOUCHPAD;
  }
  return (event.flags() & (ui::EF_IS_SYNTHESIZED | ui::EF_FROM_TOUCH)) == 0;
}

// The buttons held once `event` is dispatched: a release lets its button go.
int ButtonsHeldAfter(const ui::MouseEvent& event) {
  const int held = event.flags() & ui::EF_MOUSE_BUTTON;
  return event.type() == ui::EventType::kMouseReleased
             ? held & ~event.changed_button_flags()
             : held;
}

}  // namespace

// static
ui::EventTypeSet PointerHiding::Types() {
  return {ui::EventType::kKeyPressed,
          ui::EventType::kMouseMoved,
          ui::EventType::kMouseDragged,
          ui::EventType::kMousePressed,
          ui::EventType::kMouseReleased,
          ui::EventType::kMousewheel,
          ui::EventType::kScroll,
          ui::EventType::kScrollFlingStart,
          ui::EventType::kGesturePinchBegin,
          ui::EventType::kGesturePinchUpdate,
          ui::EventType::kGesturePinchEnd};
}

PointerHiding::PointerHiding(Pointer& pointer) : pointer_(pointer) {}

PointerHiding::~PointerHiding() = default;

void PointerHiding::Configure(const PointerHidingSettings& settings) {
  settings_ = settings;
  Used();
}

void PointerHiding::Heard(const ui::Event& event) {
  if (event.IsKeyEvent()) {
    if (settings_.when_typing && IsTyping(*event.AsKeyEvent())) {
      if (buttons_ == 0) {
        Hide();
      } else {
        VLOG(1) << "domicile: a key left the pointer shown: buttons 0x"
                << std::hex << buttons_ << " are held";
      }
    }
    return;
  }
  if (!IsPointerInput(event)) {
    return;
  }
  if (event.IsMouseEvent()) {
    buttons_ = ButtonsHeldAfter(*event.AsMouseEvent());
  }
  if (hidden_) {
    // `--vmodule=*pointer_hiding*=1` says what brought a hidden pointer back.
    VLOG(1) << "domicile: " << event.GetName() << " from device "
            << event.source_device_id() << ", flags 0x" << std::hex
            << event.flags() << ", shows the pointer";
  }
  Used();
}

void PointerHiding::Touched() {
  Used();
}

void PointerHiding::Used() {
  if (hidden_) {
    hidden_ = false;
    pointer_->Show();
  }
  Restart();
}

void PointerHiding::Restart() {
  if (!settings_.after || buttons_ != 0) {
    if (settings_.after) {
      VLOG(1) << "domicile: no pause while buttons 0x" << std::hex << buttons_
              << " are held";
    }
    pause_.Stop();
  } else {
    // Unretained: `pause_` is a member, so it cannot outlive this.
    pause_.Start(FROM_HERE, *settings_.after,
                 base::BindOnce(&PointerHiding::Hide, base::Unretained(this)));
  }
}

void PointerHiding::Hide() {
  // Every time, not once: aura shows the pointer itself on some mouse events
  // this does not read, such as an enter.
  VLOG(1) << "domicile: hiding the pointer";
  hidden_ = true;
  pointer_->Hide();
}

}  // namespace domicile
