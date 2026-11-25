// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_activity_reporter.h"

#include <memory>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/test/simple_test_tick_clock.h"
#include "base/time/time.h"
#include "components/domicile/browser/desk_activity.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/base/user_activity/user_activity_detector.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/gesture_event_details.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/events/platform/platform_event_source.h"
#include "ui/events/pointer_details.h"
#include "ui/events/types/event_type.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/vector2d.h"

namespace domicile {
namespace {

using Kinds = std::vector<ActivityKind>;

ui::KeyEvent Key() {
  return ui::KeyEvent(ui::EventType::kKeyPressed, ui::VKEY_A, ui::EF_NONE,
                      base::TimeTicks::Now());
}

ui::TouchEvent Touch() {
  return ui::TouchEvent(ui::EventType::kTouchPressed, gfx::PointF(10, 10),
                        gfx::PointF(10, 10), base::TimeTicks::Now(),
                        ui::PointerDetails(ui::EventPointerType::kTouch, 0));
}

ui::MouseEvent Mouse(ui::EventType type,
                     ui::EventFlags flags = ui::EF_NONE) {
  return ui::MouseEvent(type, gfx::PointF(10, 10), gfx::PointF(10, 10),
                        base::TimeTicks::Now(),
                        ui::EF_LEFT_MOUSE_BUTTON | flags,
                        ui::EF_LEFT_MOUSE_BUTTON);
}

ui::MouseEvent Move() {
  return Mouse(ui::EventType::kMouseMoved);
}

ui::MouseEvent Click() {
  return Mouse(ui::EventType::kMousePressed);
}

ui::MouseWheelEvent Wheel() {
  return ui::MouseWheelEvent(gfx::Vector2d(0, 120), gfx::PointF(10, 10),
                             gfx::PointF(10, 10), base::TimeTicks::Now(),
                             ui::EF_NONE, ui::EF_NONE);
}

ui::ScrollEvent Scroll() {
  return ui::ScrollEvent(ui::EventType::kScroll, gfx::PointF(10, 10),
                         gfx::PointF(10, 10), base::TimeTicks::Now(),
                         ui::EF_NONE, 0, 12, 0, 12, 2);
}

ui::GestureEvent Pinch() {
  return ui::GestureEvent(
      10, 10, ui::EF_NONE, base::TimeTicks::Now(),
      ui::GestureEventDetails(ui::EventType::kGesturePinchBegin));
}

class TestEventSource : public ui::PlatformEventSource {
 public:
  using ui::PlatformEventSource::DispatchEvent;
};

// Runs the reporter on the real detector and a source of the test's events.
class DeskActivityReporterTest : public testing::Test {
 protected:
  DeskActivityReporterTest()
      : source_(std::make_unique<TestEventSource>()),
        detector_(ui::UserActivityDetector::Get()) {
    // The detector lives as long as the process. It observes `source_` already
    // if this test is the first to get it.
    source_->RemovePlatformEventObserver(detector_);
    detector_->InitPlatformEventSourceObservationForTesting();
    Pass(base::Seconds(1));
    reporter_ = std::make_unique<DeskActivityReporter>(
        detector_, source_.get(), &clock_,
        base::BindRepeating(
            [](Kinds* reported, const ui::Event*, ActivityKind kind) {
              reported->push_back(kind);
            },
            base::Unretained(&reported_)));
  }

  ~DeskActivityReporterTest() override {
    reporter_.reset();
    detector_->ResetStateForTesting();
  }

  void Pass(base::TimeDelta time) {
    clock_.Advance(time);
    detector_->set_now_for_test(clock_.NowTicks());
  }

  template <typename Event>
  void Dispatch(Event event) {
    source_->DispatchEvent(&event);
  }

  const Kinds& reported() const { return reported_; }
  ui::UserActivityDetector& detector() { return *detector_; }
  void DestroySource() { source_.reset(); }

 private:
  base::SimpleTestTickClock clock_;
  Kinds reported_;
  std::unique_ptr<TestEventSource> source_;
  const raw_ptr<ui::UserActivityDetector> detector_;
  std::unique_ptr<DeskActivityReporter> reporter_;
};

TEST_F(DeskActivityReporterTest, AnEventIsOfTheDeviceItCameFrom) {
  Dispatch(Key());
  Pass(base::Milliseconds(200));
  Dispatch(Touch());
  Pass(base::Milliseconds(200));
  Dispatch(Move());
  Pass(base::Milliseconds(200));
  Dispatch(Mouse(ui::EventType::kMouseDragged));
  Pass(base::Milliseconds(200));
  Dispatch(Click());
  Pass(base::Milliseconds(200));
  Dispatch(Mouse(ui::EventType::kMouseReleased));
  Pass(base::Milliseconds(200));
  Dispatch(Wheel());
  Pass(base::Milliseconds(200));
  Dispatch(Scroll());
  Pass(base::Milliseconds(200));
  Dispatch(Pinch());

  EXPECT_EQ(
      reported(),
      Kinds({ActivityKind::kKey, ActivityKind::kTouch,
             ActivityKind::kPointerMotion, ActivityKind::kPointerMotion,
             ActivityKind::kPointer, ActivityKind::kPointer,
             ActivityKind::kPointer, ActivityKind::kPointer,
             ActivityKind::kPointer}));
}

TEST_F(DeskActivityReporterTest, AReleaseNobodyMadeIsNoActivity) {
  Dispatch(Mouse(ui::EventType::kMouseReleased, ui::EF_IS_SYNTHESIZED));

  EXPECT_EQ(reported(), Kinds());
}

// The detector reports the motion and then nothing for 200 ms.
TEST_F(DeskActivityReporterTest, AMovingMouseHidesNoKey) {
  Dispatch(Move());
  Pass(base::Milliseconds(10));
  Dispatch(Key());
  Pass(base::Milliseconds(10));
  Dispatch(Move());

  EXPECT_EQ(reported(),
            Kinds({ActivityKind::kPointerMotion, ActivityKind::kKey}));
}

TEST_F(DeskActivityReporterTest, AMovingMouseHidesNoClick) {
  Dispatch(Move());
  Pass(base::Milliseconds(10));
  Dispatch(Click());
  Pass(base::Milliseconds(10));
  Dispatch(Move());

  EXPECT_EQ(reported(),
            Kinds({ActivityKind::kPointerMotion, ActivityKind::kPointer}));
}

// Both the detector and the source hear it.
TEST_F(DeskActivityReporterTest, AKeyATouchOrAClickIsReportedOnce) {
  Dispatch(Key());
  EXPECT_EQ(reported(), Kinds({ActivityKind::kKey}));

  Pass(base::Milliseconds(200));
  Dispatch(Touch());
  EXPECT_EQ(reported(), Kinds({ActivityKind::kKey, ActivityKind::kTouch}));

  Pass(base::Milliseconds(200));
  Dispatch(Click());
  EXPECT_EQ(reported(), Kinds({ActivityKind::kKey, ActivityKind::kTouch,
                               ActivityKind::kPointer}));
}

TEST_F(DeskActivityReporterTest, KeysTouchesAndClicksShareAThrottle) {
  Dispatch(Key());
  Pass(base::Milliseconds(199));
  Dispatch(Key());
  Dispatch(Touch());
  Dispatch(Click());
  EXPECT_EQ(reported(), Kinds({ActivityKind::kKey}));

  Pass(base::Milliseconds(1));
  Dispatch(Key());
  EXPECT_EQ(reported(), Kinds({ActivityKind::kKey, ActivityKind::kKey}));
}

// The browser's event source goes before its reporter.
TEST_F(DeskActivityReporterTest, ActivityWithNoEventOutlivesTheSource) {
  DestroySource();

  detector().HandleExternalUserActivity();

  EXPECT_EQ(reported(), Kinds({ActivityKind::kOther}));
}

}  // namespace
}  // namespace domicile
