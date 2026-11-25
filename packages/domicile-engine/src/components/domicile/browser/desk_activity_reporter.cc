// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_activity_reporter.h"

#include <utility>

#include "base/notreached.h"
#include "base/time/tick_clock.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/types/event_type.h"

namespace domicile {
namespace {

// What `event` came from.
ActivityKind ActivityKindOf(const ui::Event& event) {
  if (event.IsKeyEvent()) {
    return ActivityKind::kKey;
  }
  if (event.IsTouchEvent()) {
    return ActivityKind::kTouch;
  }
  // A platform's own gestures are a touchpad's. A touch screen's are made from
  // touches, past the platform's event source.
  if (event.type() == ui::EventType::kMousePressed ||
      event.type() == ui::EventType::kMouseReleased ||
      event.IsMouseWheelEvent() || event.IsScrollEvent() ||
      event.IsGestureEvent()) {
    return ActivityKind::kPointer;
  }
  if (event.IsMouseEvent()) {
    return ActivityKind::kPointerMotion;
  }
  return ActivityKind::kOther;
}

// Whether the reporter hears `kind` from the event source itself.
bool HeardFromEventSource(ActivityKind kind) {
  switch (kind) {
    case ActivityKind::kKey:
    case ActivityKind::kPointer:
    case ActivityKind::kTouch:
      return true;
    case ActivityKind::kPointerMotion:
    case ActivityKind::kOther:
      return false;
  }
  NOTREACHED();
}

}  // namespace

DeskActivityReporter::DeskActivityReporter(ui::UserActivityDetector* detector,
                                           ui::PlatformEventSource* source,
                                           const base::TickClock* clock,
                                           Report report)
    : clock_(clock), report_(std::move(report)) {
  detector_observation_.Observe(detector);
  source_observation_.Observe(source);
}

DeskActivityReporter::~DeskActivityReporter() = default;

void DeskActivityReporter::OnUserActivity(const ui::Event* event) {
  if (event == nullptr) {
    report_.Run(nullptr, ActivityKind::kOther);
    return;
  }
  const ActivityKind kind = ActivityKindOf(*event);
  if (!HeardFromEventSource(kind)) {
    report_.Run(event, kind);
  }
}

void DeskActivityReporter::WillProcessEvent(const ui::PlatformEvent& event) {}

void DeskActivityReporter::DidProcessEvent(const ui::PlatformEvent& event) {
  // Ozone's platform events are ui::Events. The detector skips those of the
  // mouse that nobody made, such as a nested desk's releases of the buttons
  // its host took over.
  if (event->IsMouseEvent() && (event->flags() & ui::EF_IS_SYNTHESIZED)) {
    return;
  }
  const ActivityKind kind = ActivityKindOf(*event);
  if (HeardFromEventSource(kind) &&
      throttle_.ShouldReport(clock_->NowTicks())) {
    report_.Run(event, kind);
  }
}

void DeskActivityReporter::PlatformEventSourceDestroying() {
  source_observation_.Reset();
}

}  // namespace domicile
