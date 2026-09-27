// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/scroll_accelerator.h"

#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/vector2d.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace ui {
namespace {

// Chromium's sign, as `GetAxisValue` hands it over: negative is down.
constexpr gfx::Vector2dF kDown{0, -10};

// The pad's report interval: two events 10 ms apart moving 10 units is one
// unit per millisecond, which is past the threshold and short of the cap.
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
  // The first event of a gesture has no speed to measure.
  EXPECT_EQ(accelerator.Scroll(kDown, At(0)), gfx::Vector2d(0, -10));
  // One unit per millisecond is a gain of 1.75: -17.5, of which the half is
  // carried rather than dropped...
  EXPECT_EQ(accelerator.Scroll(kDown, At(10)), gfx::Vector2d(0, -17));
  // ...and arrives with the next event.
  EXPECT_EQ(accelerator.Scroll(kDown, At(20)), gfx::Vector2d(0, -18));
}

TEST(ScrollAcceleratorTest, TheGainIsCapped) {
  ScrollAccelerator accelerator;
  accelerator.Scroll({0, -100}, At(0));
  // Ten units per millisecond would be a gain of 15.25 uncapped.
  EXPECT_EQ(accelerator.Scroll({0, -100}, At(10)), gfx::Vector2d(0, -400));
}

TEST(ScrollAcceleratorTest, ADiagonalScrollKeepsItsDirection) {
  ScrollAccelerator accelerator;
  // Speed is the length of the movement, not either axis alone: (6, -8) is
  // ten units, the same one unit per millisecond as `kDown`.
  accelerator.Scroll({6, -8}, At(0));
  EXPECT_EQ(accelerator.Scroll({6, -8}, At(10)), gfx::Vector2d(10, -14));
}

TEST(ScrollAcceleratorTest, FractionsAddUp) {
  // libinput reports a slow finger in fractions of a unit, and truncating
  // each one to an integer, which is what the converter did, scrolls nothing.
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
  // Unaccelerated however soon it follows, where a millisecond after the last
  // event would be the cap, and without the carried half, which would make
  // this -11.1 and so -11.
  EXPECT_EQ(accelerator.Scroll({0, -10.6f}, At(21)), gfx::Vector2d(0, -10));
}

TEST(ScrollAcceleratorTest, APauseStartsTheNextGestureOver) {
  // Fingers that rest on the pad without lifting report no stop, and a scroll
  // that resumes has to be measured from where it resumed, not where it
  // paused.
  ScrollAccelerator accelerator;
  accelerator.Scroll(kDown, At(0));
  accelerator.Scroll(kDown, At(10));
  EXPECT_EQ(accelerator.Scroll({0, -100}, At(500)), gfx::Vector2d(0, -100));
}

}  // namespace
}  // namespace ui
