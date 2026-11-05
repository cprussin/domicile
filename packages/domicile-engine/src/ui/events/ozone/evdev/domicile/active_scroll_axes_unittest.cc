// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/active_scroll_axes.h"

#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

TEST(ActiveScrollAxesTest, DeviceRemovalStopsOnlyDeliveredAxesOnce) {
  for (const auto source :
       {NativeScrollSource::kFinger, NativeScrollSource::kContinuous}) {
    ActiveScrollAxes axes;
    EXPECT_FALSE(axes.TakeStop());
    axes.Observe(source, true, true, false, false);
    const auto stop = axes.TakeStop();
    ASSERT_TRUE(stop);
    EXPECT_EQ(stop->source, source);
    EXPECT_TRUE(stop->stop_x);
    EXPECT_TRUE(stop->stop_y);
    ASSERT_TRUE(stop->axis_distance);
    EXPECT_EQ((*stop->axis_distance)[0], 0);
    EXPECT_EQ((*stop->axis_distance)[1], 0);
    EXPECT_FALSE(axes.TakeStop());
  }
}

TEST(ActiveScrollAxesTest, AnIndependentStopLeavesOnlyTheOtherAxisActive) {
  ActiveScrollAxes axes;
  axes.Observe(NativeScrollSource::kFinger, true, true, false, false);
  axes.Observe(NativeScrollSource::kFinger, false, false, true, false);
  const auto stop = axes.TakeStop();
  ASSERT_TRUE(stop);
  EXPECT_FALSE(stop->stop_x);
  EXPECT_TRUE(stop->stop_y);

  axes.Observe(NativeScrollSource::kContinuous, false, true, false, false);
  axes.Observe(NativeScrollSource::kContinuous, false, false, false, true);
  EXPECT_FALSE(axes.TakeStop());
}

TEST(ActiveScrollAxesTest, WheelsNeverAcquireOrEraseAFingerGesture) {
  for (const auto source :
       {NativeScrollSource::kWheel, NativeScrollSource::kWheelTilt}) {
    ActiveScrollAxes axes;
    axes.Observe(source, true, true, false, false);
    EXPECT_FALSE(axes.TakeStop());
    axes.Observe(NativeScrollSource::kFinger, true, false, false, false);
    axes.Observe(source, false, true, false, false);
    const auto stop = axes.TakeStop();
    ASSERT_TRUE(stop);
    EXPECT_EQ(stop->source, NativeScrollSource::kFinger);
    EXPECT_TRUE(stop->stop_x);
    EXPECT_FALSE(stop->stop_y);
  }
}

}  // namespace
}  // namespace ui
