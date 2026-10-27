// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_INPUT_H_
#define UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_INPUT_H_

#include <stdint.h>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/ozone/public/ozone_platform.h"

namespace ui {

class Event;
class KeyboardLayoutEngine;

// A headless desk's pointer and keyboard, which only emulated input (EIS)
// drives: each `DomicileDeskInput` becomes the event a real device's would,
// as DRM's evdev makes them. See docs/architecture/A-HEADLESS-DESKTOP.md in
// the Domicile repository.
//
// - The pointer starts at the desk's origin. Buttons held turn a move into a
//   drag, and every event carries the buttons and modifiers held.
// - A key is looked up in `layout`, which the compositor's keymap sets, so
//   the desk types what its keyboard config says.
// - One wheel detent is 15 pixels, as the compositor scrolls a window by.
// - A button or key with no evdev meaning is dropped.
// - No key repeats: a held key is pressed once.
class HeadlessDeskInput {
 public:
  // Takes each event, located in desk pixels.
  using Deliver = base::RepeatingCallback<void(Event*)>;

  HeadlessDeskInput(Deliver deliver, const KeyboardLayoutEngine* layout);

  HeadlessDeskInput(const HeadlessDeskInput&) = delete;
  HeadlessDeskInput& operator=(const HeadlessDeskInput&) = delete;

  ~HeadlessDeskInput();

  void Inject(const DomicileDeskInput& input);

 private:
  void MovePointer(const gfx::PointF& to);
  void PressButton(uint32_t code, bool pressed);
  void Scroll(double x, double y);
  void PressKey(uint32_t code, bool pressed);

  const Deliver deliver_;
  const raw_ptr<const KeyboardLayoutEngine> layout_;
  gfx::PointF pointer_;
  // The EF_*_MOUSE_BUTTON flags held.
  int buttons_ = 0;
  // The modifier and lock flags held.
  int modifiers_ = 0;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_INPUT_H_
