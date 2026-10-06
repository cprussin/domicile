// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/scroll_accelerator.h"

#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/vector2d.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace ui {
namespace {

// Chromium's sign, as `GetAxisValue` returns it: negative is down.
constexpr gfx::Vector2dF kDown{0, -10};

// Tests space events 10 ms apart, a typical pad interval, so `kDown` is
// 1 unit/ms: above the threshold, below the cap.
base::TimeTicks At(int ms) {
  return base::TimeTicks() + base::Milliseconds(ms);
}

TEST(ScrollAcceleratorTest, ASlowScrollIsNotAccelerated) {
  ScrollAccelerator accelerator;
  EXPECT_EQ(accelerator.Scroll({0, -2}, At(0)), gfx::Vector2d(0, -2));
  EXPECT_EQ(accelerator.Scroll({0, -2}, At(10)), gfx::Vector2d(0, -2));
}

TEST(ScrollAcceleratorTest, AFastScrollIsAccelerated) {
  ScrollAccelerator accelerator;
  // The first event of a gesture has no speed.
  EXPECT_EQ(accelerator.Scroll(kDown, At(0)), gfx::Vector2d(0, -10));
  // 1 unit/ms is a gain of 1.75: -17.5. The -0.5 carries...
  EXPECT_EQ(accelerator.Scroll(kDown, At(10)), gfx::Vector2d(0, -17));
  // ...into the next event.
  EXPECT_EQ(accelerator.Scroll(kDown, At(20)), gfx::Vector2d(0, -18));
}

TEST(ScrollAcceleratorTest, TheGainIsCapped) {
  ScrollAccelerator accelerator;
  accelerator.Scroll({0, -100}, At(0));
  // 10 units/ms would be a gain of 15.25 without the cap.
  EXPECT_EQ(accelerator.Scroll({0, -100}, At(10)), gfx::Vector2d(0, -400));
}

TEST(ScrollAcceleratorTest, ADiagonalScrollKeepsItsDirection) {
  ScrollAccelerator accelerator;
  // Speed uses the vector length: (6, -8) is 10 units, the same 1 unit/ms as
  // `kDown`.
  accelerator.Scroll({6, -8}, At(0));
  EXPECT_EQ(accelerator.Scroll({6, -8}, At(10)), gfx::Vector2d(10, -14));
}

TEST(ScrollAcceleratorTest, FractionsAddUp) {
  // A slow finger reports fractions of a unit; truncating each would never
  // scroll.
  ScrollAccelerator accelerator;
  EXPECT_EQ(accelerator.Scroll({0.4f, 0}, At(0)), gfx::Vector2d(0, 0));
  EXPECT_EQ(accelerator.Scroll({0.4f, 0}, At(10)), gfx::Vector2d(0, 0));
  EXPECT_EQ(accelerator.Scroll({0.4f, 0}, At(20)), gfx::Vector2d(1, 0));
}

TEST(ScrollAcceleratorTest, AStopStartsTheNextGestureOver) {
  ScrollAccelerator accelerator;
  accelerator.Scroll(kDown, At(0));
  accelerator.Scroll(kDown, At(10));  // -17, carrying -0.5
  // libinput's scroll stop: the fingers left the pad.
  EXPECT_EQ(accelerator.Scroll({0, 0}, At(20)), gfx::Vector2d(0, 0));
  // Unaccelerated even 1 ms later, and without the carried -0.5 (which would
  // make this -11).
  EXPECT_EQ(accelerator.Scroll({0, -10.6f}, At(21)), gfx::Vector2d(0, -10));
}

TEST(ScrollAcceleratorTest, APauseStartsTheNextGestureOver) {
  // Resting fingers report no stop, so a pause must also reset the speed.
  ScrollAccelerator accelerator;
  accelerator.Scroll(kDown, At(0));
  accelerator.Scroll(kDown, At(10));
  EXPECT_EQ(accelerator.Scroll({0, -100}, At(500)), gfx::Vector2d(0, -100));
}

}  // namespace
}  // namespace ui
