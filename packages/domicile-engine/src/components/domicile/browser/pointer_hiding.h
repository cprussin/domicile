// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_POINTER_HIDING_H_
#define COMPONENTS_DOMICILE_BROWSER_POINTER_HIDING_H_

#include <set>

#include "base/memory/raw_ref.h"
#include "base/timer/timer.h"
#include "components/domicile/browser/desk_pointer_hiding.h"
#include "ui/events/types/event_type.h"

namespace ui {
class Event;
}  // namespace ui

namespace domicile {

// Hides the pointer on a typing key press and after a pause in pointer
// input, as the desk's settings say, and shows it on the next pointer input.
// Keys, touch and synthesized moves never show it.
//
// Hiding changes only the image: the pointer keeps its focus and hover. Lives
// on the UI thread; `StartPointerHiding` in //chrome/browser/domicile feeds it
// aura's events.
class PointerHiding {
 public:
  // The pointer image this hides and shows.
  class Pointer {
   public:
    virtual ~Pointer() = default;
    virtual void Hide() = 0;
    virtual void Show() = 0;
  };

  // The event types `Heard` reads.
  static std::set<ui::EventType> Types();

  explicit PointerHiding(Pointer& pointer);
  PointerHiding(const PointerHiding&) = delete;
  PointerHiding& operator=(const PointerHiding&) = delete;
  ~PointerHiding();

  // Shows the pointer, and starts the pause over under `settings`.
  void Configure(const PointerHidingSettings& settings);

  // Aura dispatched `event`, one of `Types()`.
  void Heard(const ui::Event& event);

  // A touchpad gesture the shell or an application took. Those never reach
  // aura.
  void Touched();

 private:
  // The pointer was used: show it and start the pause over.
  void Used();
  // Starts the pause over, or stops it while there is none or a button is
  // held.
  void Restart();
  void Hide();

  const raw_ref<Pointer> pointer_;
  PointerHidingSettings settings_;
  // The mouse buttons held, as `ui::EF_MOUSE_BUTTON` flags.
  int buttons_ = 0;
  // Whether this hid the pointer, and so shows it on the next pointer input.
  bool hidden_ = false;
  base::OneShotTimer pause_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_POINTER_HIDING_H_
