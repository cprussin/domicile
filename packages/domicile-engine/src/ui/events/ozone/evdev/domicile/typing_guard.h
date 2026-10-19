// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_TYPING_GUARD_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_TYPING_GUARD_H_

#include <optional>

#include "base/component_export.h"
#include "base/containers/flat_set.h"
#include "base/time/time.h"

namespace ui {

// Rests the touchpads while a keyboard types, as libinput's
// disable-while-typing does.
//
// libinput pairs a touchpad with a keyboard only inside one libinput context,
// and evdev opens each device in a context of its own, so libinput's feature
// never sees a key. Keyboards report keys here; touchpads ask before each
// event. One per `InputDeviceFactoryEvdev`, on the evdev thread.
//
// See docs/RUNNING-A-DESKTOP.md#disable-while-typing in the Domicile
// repository.
class COMPONENT_EXPORT(EVDEV) TypingGuard {
 public:
  TypingGuard();
  TypingGuard(const TypingGuard&) = delete;
  TypingGuard& operator=(const TypingGuard&) = delete;
  ~TypingGuard();

  // On by default. Off drops nothing.
  void SetEnabled(bool enabled);
  bool enabled() const { return enabled_; }

  // A keyboard's key changed. A key in the typing rows rests the pads, unless
  // Ctrl, Alt or Super is held: that is a shortcut, often followed by a click.
  void OnKey(unsigned int key, bool down, base::TimeTicks time);

  // Whether to drop a touchpad's motion or scroll at `time`. Motion during a
  // held button is a drag and always passes.
  bool DropsMotion(base::TimeTicks time) const;

  // Whether to drop a touchpad's button change at `time`: taps and clicks. A
  // release goes the way its press went, so no button is left held.
  bool DropsButton(unsigned int button, bool down, base::TimeTicks time);

 private:
  bool Resting(base::TimeTicks time) const;

  bool enabled_ = true;
  std::optional<base::TimeTicks> resting_until_;
  base::flat_set<unsigned int> shortcut_modifiers_held_;
  base::flat_set<unsigned int> buttons_passed_;
  base::flat_set<unsigned int> buttons_dropped_;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_TYPING_GUARD_H_
