// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_OZONE_EVDEV_DOMICILE_TYPING_GUARD_H_
#define UI_EVENTS_OZONE_EVDEV_DOMICILE_TYPING_GUARD_H_

#include <optional>
#include <utility>

#include "base/component_export.h"
#include "base/containers/flat_set.h"
#include "base/time/time.h"

namespace ui {

// Applies configurable typing pauses to touchpad events on the evdev thread.
// Native libinput mode uses the shared seat's keyboard pairing instead.
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
  void SetPauses(base::TimeDelta one_key, base::TimeDelta typing);
  void ResetPause();
  void RemoveDevice(int device_id);

  // A keyboard's key changed. A key in the typing rows rests the pads, unless
  // Ctrl, Alt or Super is held: that is a shortcut, often followed by a click.
  void OnKey(unsigned int key, bool down, base::TimeTicks time);

  // Whether to drop a touchpad's motion or scroll at `time`. Motion during a
  // held button is a drag and always passes.
  bool DropsMotion(base::TimeTicks time, int device_id = 0) const;

  // Whether to drop a touchpad's button change at `time`: taps and clicks. A
  // release goes the way its press went, so no button is left held.
  bool DropsButton(unsigned int button,
                   bool down,
                   base::TimeTicks time,
                   bool applies = true,
                   int device_id = 0);

 private:
  bool Resting(base::TimeTicks time) const;

  bool enabled_ = true;
  base::TimeDelta one_key_ = base::Milliseconds(200);
  base::TimeDelta typing_ = base::Milliseconds(500);
  std::optional<base::TimeTicks> resting_until_;
  std::optional<base::TimeTicks> last_typing_key_;
  base::flat_set<unsigned int> shortcut_modifiers_held_;
  base::flat_set<std::pair<int, unsigned int>> buttons_passed_;
  base::flat_set<std::pair<int, unsigned int>> buttons_dropped_;
};

}  // namespace ui

#endif  // UI_EVENTS_OZONE_EVDEV_DOMICILE_TYPING_GUARD_H_
