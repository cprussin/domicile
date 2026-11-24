// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_METHOD_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_METHOD_H_

#include <stdint.h>

#include <deque>
#include <memory>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "ui/base/ime/domicile/desk_input_method.h"
#include "ui/gfx/native_ui_types.h"

namespace ui {

class KeyEvent;
class LinuxInputMethodContext;
class LinuxInputMethodContextDelegate;

// The DRM platform's input method: Chromium's `InputMethodAuraLinux`, with a
// context per window that is an editor on the desk's input method (fcitx5,
// IBus) through the compositor. See ui/base/ime/domicile/desk_input_method.h
// and docs/architecture/TEXT-INPUT.md in the Domicile repository.
//
// Without it the platform built `InputMethodMinimal`, so a page's field was
// no editor and keys arrived uncomposed.
//
// - The window whose field has focus sends the field: whether it takes text,
//   the text around the cursor, its kind and the caret.
// - While the input method composes, that window's keys go to it first and
//   are held. A key it passes on comes back and is dispatched again, past the
//   input method. The rest it composed.
// - What it composed reaches the window's field as Chromium's composition
//   and commits.
//
// One per platform, on the UI thread.
class DrmInputMethod {
 public:
  using FieldSent = base::RepeatingCallback<void(const DeskTextField&)>;
  // An evdev code, pressed or released. Whether it went anywhere.
  using KeySent = base::RepeatingCallback<bool(uint32_t, bool)>;
  // Dispatches `event` to the window `widget` again.
  using Redispatch =
      base::RepeatingCallback<void(gfx::AcceleratedWidget, KeyEvent*)>;

  DrmInputMethod(FieldSent field_sent, KeySent key_sent, Redispatch redispatch);
  DrmInputMethod(const DrmInputMethod&) = delete;
  DrmInputMethod& operator=(const DrmInputMethod&) = delete;
  ~DrmInputMethod();

  // One through the process's `DeskInputMethod`, listening to it.
  static std::unique_ptr<DrmInputMethod> ForTheDesk(Redispatch redispatch);

  // For `GetInputMethodContextFactoryForOzone`.
  std::unique_ptr<LinuxInputMethodContext> CreateContext(
      LinuxInputMethodContextDelegate* delegate);

  // From the desk.
  void SetComposing(bool composing);
  void Compose(const DeskComposition& composition);
  void Passed(uint32_t evdev_code, bool pressed);

  // Whether `event` was dispatched again by this, past the input method.
  static bool IsPassed(const KeyEvent& event);

 private:
  class Context;

  struct Held {
    Held(gfx::AcceleratedWidget widget, std::unique_ptr<KeyEvent> event);
    Held(Held&&);
    Held& operator=(Held&&);
    ~Held();

    gfx::AcceleratedWidget widget;
    std::unique_ptr<KeyEvent> event;
  };

  // A context's field changed, or it took or lost focus.
  void Changed(Context* context);
  void Gone(Context* context);
  // Whether `event`, from `context`, goes to the input method first. Holds it
  // if so.
  bool TakesKey(Context* context, const KeyEvent& event);

  const FieldSent field_sent_;
  const KeySent key_sent_;
  const Redispatch redispatch_;

  // The context whose field has focus. Not owned: a context says when it is
  // gone.
  raw_ptr<Context> focused_ = nullptr;
  bool composing_ = false;
  // Keys sent to the input method, oldest first, until it passes them on or
  // a later one comes back.
  std::deque<Held> held_;

  base::WeakPtrFactory<DrmInputMethod> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_METHOD_H_
