// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/wheel_ticks.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/vector2d.h"

namespace ui {
namespace {

TEST(WheelTicksTest, AClickDownIsOneNotchDown) {
  // libinput's down is positive; Chromium's is negative.
  EXPECT_EQ(WheelTicks(0, 1), gfx::Vector2d(0, -120));
}

TEST(WheelTicksTest, AClickRightIsOneNotchRight) {
  EXPECT_EQ(WheelTicks(1, 0), gfx::Vector2d(-120, 0));
}

TEST(WheelTicksTest, SeveralClicksInOneEventAreSeveralNotches) {
  EXPECT_EQ(WheelTicks(0, -3), gfx::Vector2d(0, 360));
}

}  // namespace
}  // namespace ui
