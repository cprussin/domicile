// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_ACTIVITY_REPORTER_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_ACTIVITY_REPORTER_H_

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/scoped_observation.h"
#include "base/scoped_observation_traits.h"
#include "components/domicile/browser/desk_activity.h"
#include "ui/base/user_activity/user_activity_detector.h"
#include "ui/base/user_activity/user_activity_observer.h"
#include "ui/events/platform/platform_event_observer.h"
#include "ui/events/platform/platform_event_source.h"
#include "ui/events/platform_event.h"

namespace base {

class TickClock;

template <>
struct ScopedObservationTraits<ui::PlatformEventSource,
                               ui::PlatformEventObserver> {
  static void AddObserver(ui::PlatformEventSource* source,
                          ui::PlatformEventObserver* observer) {
    source->AddPlatformEventObserver(observer);
  }
  static void RemoveObserver(ui::PlatformEventSource* source,
                             ui::PlatformEventObserver* observer) {
    source->RemovePlatformEventObserver(observer);
  }
};

}  // namespace base

namespace ui {
class Event;
}

namespace domicile {

// Reports the desk's input and its kind.
//
// `ui::UserActivityDetector` watches for pointer motion: it sees each event as
// the platform dispatches it, whatever page it is for, at most every 200 ms,
// and skips the mouse moves aura synthesizes under a still pointer.
//
// Its 200 ms are shared by every kind of input, so a moving mouse hides keys
// and clicks from it, and the compositor may ignore that motion
// (`idle.ignore_pointer_motion`). Keys, touches and the pointer's other input
// are heard from the platform's event source instead, at most every 200 ms of
// their own.
class DeskActivityReporter : public ui::UserActivityObserver,
                             public ui::PlatformEventObserver {
 public:
  // `event` is null for activity reported with no event.
  using Report =
      base::RepeatingCallback<void(const ui::Event* event, ActivityKind kind)>;

  // `detector` and `clock` must outlive this.
  DeskActivityReporter(ui::UserActivityDetector* detector,
                       ui::PlatformEventSource* source,
                       const base::TickClock* clock,
                       Report report);
  DeskActivityReporter(const DeskActivityReporter&) = delete;
  DeskActivityReporter& operator=(const DeskActivityReporter&) = delete;
  ~DeskActivityReporter() override;

  // ui::UserActivityObserver:
  void OnUserActivity(const ui::Event* event) override;

  // ui::PlatformEventObserver:
  void WillProcessEvent(const ui::PlatformEvent& event) override;
  void DidProcessEvent(const ui::PlatformEvent& event) override;
  void PlatformEventSourceDestroying() override;

 private:
  const raw_ptr<const base::TickClock> clock_;
  const Report report_;

  // All that is heard from the source shares it, since all of it counts.
  ActivityThrottle throttle_;

  base::ScopedObservation<ui::UserActivityDetector, ui::UserActivityObserver>
      detector_observation_{this};
  base::ScopedObservation<ui::PlatformEventSource, ui::PlatformEventObserver>
      source_observation_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_ACTIVITY_REPORTER_H_
