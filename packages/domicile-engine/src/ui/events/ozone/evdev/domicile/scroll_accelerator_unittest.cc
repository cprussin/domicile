// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/scroll_accelerator.h"

#include <limits>

#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/ozone/evdev/domicile/scroll_factor.h"
#include "ui/gfx/geometry/vector2d.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace ui {

TEST(ScrollAcceleratorTest, LinearScrollingPreservesSubpixelDistance) {
  ScrollAccelerator scroll;
  scroll.Configure(false, 0.5);
  const auto delta =
      scroll.Scroll(gfx::Vector2dF(0.25, -0.5), base::TimeTicks());
  EXPECT_FLOAT_EQ(delta.x(), 0.125);
  EXPECT_FLOAT_EQ(delta.y(), -0.25);
}
namespace {

// Chromium's sign, as `GetAxisValue` returns it: negative is down.
constexpr gfx::Vector2dF kDown{0, -10};

// Tests space events 10 ms apart, a typical pad interval, so `kDown` is
// 1 unit/ms: above the threshold, below the cap.
base::TimeTicks At(int ms) {
  return base::TimeTicks() + base::Milliseconds(ms);
}

TEST(ScrollAcceleratorTest,
     ConfigurableFactorDoesNotChangeAccelerationThreshold) {
  ScrollAccelerator accelerator;
  accelerator.Configure(true, 0.5);
  EXPECT_EQ(accelerator.Scroll(kDown, At(0)), gfx::Vector2dF(0, -5));
  EXPECT_EQ(accelerator.Scroll(kDown, At(10)), gfx::Vector2dF(0, -8));
  EXPECT_EQ(accelerator.Scroll(kDown, At(20)), gfx::Vector2dF(0, -9));
}

TEST(ScrollAcceleratorTest, LinearScalingAppliesOnceAndResetsOnReload) {
  ScrollAccelerator accelerator;
  accelerator.Configure(false, 0.25);
  EXPECT_EQ(accelerator.Scroll({2, -2}, At(0)), gfx::Vector2dF(0.5, -0.5));
  EXPECT_EQ(accelerator.Scroll({2, -2}, At(1)), gfx::Vector2dF(0.5, -0.5));
  EXPECT_EQ(accelerator.Scroll({2, -2}, At(2)), gfx::Vector2dF(0.5, -0.5));
  accelerator.Configure(false, 1);
  EXPECT_EQ(accelerator.Scroll({2, -2}, At(3)), gfx::Vector2dF(2, -2));
  EXPECT_EQ(accelerator.Scroll({20, -20}, At(4)), gfx::Vector2dF(20, -20));
}

TEST(ScrollAcceleratorTest,
     LargeFiniteFactorsSaturateAtTheEventCoordinateRange) {
  EXPECT_EQ(ScaleScrollAxis(7.5, 2), 15);
  EXPECT_EQ(ScaleScrollAxis(-11.25, 0.5), -5.625);
  EXPECT_EQ(ScaleScrollAxis(15, 1e308), std::numeric_limits<int>::max());
  EXPECT_EQ(ScaleScrollAxis(-15, 1e308), std::numeric_limits<int>::min());
  ScrollAccelerator accelerator;
  accelerator.Configure(false, std::numeric_limits<double>::max());
  EXPECT_EQ(
      accelerator.Scroll({1, -1}, At(0)),
      gfx::Vector2dF(static_cast<float>(std::numeric_limits<int>::max()),
                     static_cast<float>(std::numeric_limits<int>::min())));
  EXPECT_EQ(accelerator.Scroll({0, 0}, At(1)), gfx::Vector2dF());
  accelerator.Configure(false, 1);
  EXPECT_EQ(accelerator.Scroll({1, -1}, At(2)), gfx::Vector2dF(1, -1));
}

TEST(ScrollAcceleratorTest, ASlowScrollIsNotAccelerated) {
  ScrollAccelerator accelerator;
  EXPECT_EQ(accelerator.Scroll({0, -2}, At(0)), gfx::Vector2dF(0, -2));
  EXPECT_EQ(accelerator.Scroll({0, -2}, At(10)), gfx::Vector2dF(0, -2));
}

TEST(ScrollAcceleratorTest, AFastScrollIsAccelerated) {
  ScrollAccelerator accelerator;
  // The first event of a gesture has no speed.
  EXPECT_EQ(accelerator.Scroll(kDown, At(0)), gfx::Vector2dF(0, -10));
  // 1 unit/ms is a gain of 1.75: -17.5. The -0.5 carries...
  EXPECT_EQ(accelerator.Scroll(kDown, At(10)), gfx::Vector2dF(0, -17));
  // ...into the next event.
  EXPECT_EQ(accelerator.Scroll(kDown, At(20)), gfx::Vector2dF(0, -18));
}

TEST(ScrollAcceleratorTest, TheGainIsCapped) {
  ScrollAccelerator accelerator;
  accelerator.Scroll({0, -100}, At(0));
  // 10 units/ms would be a gain of 15.25 without the cap.
  EXPECT_EQ(accelerator.Scroll({0, -100}, At(10)), gfx::Vector2dF(0, -400));
}

TEST(ScrollAcceleratorTest, ADiagonalScrollKeepsItsDirection) {
  ScrollAccelerator accelerator;
  // Speed uses the vector length: (6, -8) is 10 units, the same 1 unit/ms as
  // `kDown`.
  accelerator.Scroll({6, -8}, At(0));
  EXPECT_EQ(accelerator.Scroll({6, -8}, At(10)), gfx::Vector2dF(10, -14));
}

TEST(ScrollAcceleratorTest, FractionsAddUp) {
  // A slow finger reports fractions of a unit; truncating each would never
  // scroll.
  ScrollAccelerator accelerator;
  EXPECT_EQ(accelerator.Scroll({0.4f, 0}, At(0)), gfx::Vector2dF(0, 0));
  EXPECT_EQ(accelerator.Scroll({0.4f, 0}, At(10)), gfx::Vector2dF(0, 0));
  EXPECT_EQ(accelerator.Scroll({0.4f, 0}, At(20)), gfx::Vector2dF(1, 0));
}

TEST(ScrollAcceleratorTest, AnAxisStopClearsOnlyItsFraction) {
  ScrollAccelerator accelerator;
  accelerator.Scroll({0.6f, 0.6f}, At(0));
  accelerator.Stop(true, false);
  EXPECT_EQ(accelerator.Scroll({0.6f, 0.6f}, At(10)), gfx::Vector2dF(0, 1));
  accelerator.Stop(false, true);
  EXPECT_EQ(accelerator.Scroll({0.6f, 0.6f}, At(20)), gfx::Vector2dF(1, 0));
}

TEST(ScrollAcceleratorTest, TheFinalAxisStopStartsTheNextGestureOver) {
  ScrollAccelerator vertical;
  vertical.Scroll(kDown, At(0));
  vertical.Scroll(kDown, At(10));
  vertical.Stop(false, true);
  EXPECT_EQ(vertical.Scroll(kDown, At(11)), kDown);

  ScrollAccelerator diagonal;
  diagonal.Scroll({6, -8}, At(0));
  diagonal.Scroll({6, -8}, At(10));
  diagonal.Stop(true, false);
  EXPECT_LT(diagonal.Scroll(kDown, At(11)).y(), -10);
  diagonal.Stop(false, true);
  EXPECT_EQ(diagonal.Scroll(kDown, At(12)), kDown);
}

TEST(ScrollAcceleratorTest, AStopStartsTheNextGestureOver) {
  ScrollAccelerator accelerator;
  accelerator.Scroll(kDown, At(0));
  accelerator.Scroll(kDown, At(10));  // -17, carrying -0.5
  // libinput's scroll stop: the fingers left the pad.
  EXPECT_EQ(accelerator.Scroll({0, 0}, At(20)), gfx::Vector2dF(0, 0));
  // Unaccelerated even 1 ms later, and without the carried -0.5 (which would
  // make this -11).
  EXPECT_EQ(accelerator.Scroll({0, -10.6f}, At(21)), gfx::Vector2dF(0, -10));
}

TEST(ScrollAcceleratorTest, APauseStartsTheNextGestureOver) {
  // Resting fingers report no stop, so a pause must also reset the speed.
  ScrollAccelerator accelerator;
  accelerator.Scroll(kDown, At(0));
  accelerator.Scroll(kDown, At(10));
  EXPECT_EQ(accelerator.Scroll({0, -100}, At(500)), gfx::Vector2dF(0, -100));
}

}  // namespace
}  // namespace ui
