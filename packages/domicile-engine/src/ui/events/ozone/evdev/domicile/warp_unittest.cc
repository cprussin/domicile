// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include <vector>

#include "base/run_loop.h"
#include "base/task/single_thread_task_runner.h"
#include "base/test/task_environment.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/base_event_utils.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/ozone/device/device_manager.h"
#include "ui/events/ozone/evdev/device_event_dispatcher_evdev.h"
#include "ui/events/ozone/evdev/event_factory_evdev.h"
#include "ui/events/ozone/evdev/testing/fake_cursor_delegate_evdev.h"
#include "ui/events/platform/platform_event_observer.h"
#include "ui/events/platform_event.h"
#include "ui/events/pointer_details.h"
#include "ui/events/types/event_type.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/native_ui_types.h"

namespace ui {
namespace {

// A machine with no input devices. Nothing here starts the evdev thread, so
// nothing asks.
class NoDevices : public DeviceManager {
 public:
  void ScanDevices(DeviceEventObserver*) override {}
  void AddObserver(DeviceEventObserver*) override {}
  void RemoveObserver(DeviceEventObserver*) override {}
};

// Each mouse move the factory dispatches.
class Moves : public PlatformEventObserver {
 public:
  struct Move {
    int flags;
    gfx::PointF at;
  };

  std::vector<Move> moves;

  void WillProcessEvent(const PlatformEvent& event) override {
    if (event->type() == EventType::kMouseMoved) {
      moves.push_back({event->flags(), event->AsLocatedEvent()->location_f()});
    }
  }
  void DidProcessEvent(const PlatformEvent&) override {}
};

class EvdevWarpTest : public testing::Test {
 protected:
  EvdevWarpTest() : factory_(&cursor_, &devices_, nullptr) {
    factory_.SetUserInputTaskRunner(
        base::SingleThreadTaskRunner::GetCurrentDefault());
    factory_.AddPlatformEventObserver(&moves_);
  }
  ~EvdevWarpTest() override { factory_.RemovePlatformEventObserver(&moves_); }

  base::test::SingleThreadTaskEnvironment task_environment_;
  FakeCursorDelegateEvdev cursor_;
  NoDevices devices_;
  EventFactoryEvdev factory_;
  Moves moves_;
};

// A shell warps the pointer on each keyboard focus change. The move that
// reports it is synthesized, so the pointer hiding typing did stays: aura's
// `CompoundEventFilter` and `PointerHiding` show the pointer only for a move
// that is not.
TEST_F(EvdevWarpTest, AWarpIsASynthesizedMove) {
  factory_.WarpCursorTo(gfx::kNullAcceleratedWidget, gfx::PointF(40, 30));
  base::RunLoop().RunUntilIdle();

  ASSERT_EQ(moves_.moves.size(), 1u);
  EXPECT_TRUE(moves_.moves[0].flags & EF_IS_SYNTHESIZED);
  EXPECT_EQ(moves_.moves[0].at, gfx::PointF(40, 30));
  EXPECT_EQ(cursor_.GetLocation(), gfx::PointF(40, 30));
}

// A mouse's own move is still a hand on it.
TEST_F(EvdevWarpTest, AMouseMoveIsNotSynthesized) {
  factory_.DispatchMouseMoveEvent(MouseMoveEventParams(
      /*device_id=*/3, EF_NONE, gfx::PointF(5, 6), /*ordinal_delta=*/nullptr,
      PointerDetails(EventPointerType::kMouse), EventTimeForNow()));

  ASSERT_EQ(moves_.moves.size(), 1u);
  EXPECT_FALSE(moves_.moves[0].flags & EF_IS_SYNTHESIZED);
}

}  // namespace
}  // namespace ui
