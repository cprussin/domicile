// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/fling_tracker.h"

#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace ui {
namespace {

base::TimeTicks At(int ms) {
  return base::TimeTicks() + base::Milliseconds(ms);
}

TEST(FlingTrackerTest, ASteadyFlickGlidesAtItsSpeed) {
  FlingTracker fling;
  for (int ms = 0; ms <= 40; ms += 10) {
    fling.Scroll(gfx::Vector2dF(5, -10), At(ms));
  }
  const gfx::Vector2dF velocity = fling.Release(At(50));
  EXPECT_FLOAT_EQ(velocity.x(), 500);
  EXPECT_FLOAT_EQ(velocity.y(), -1000);
}

TEST(FlingTrackerTest, OnlyTheMotionJustBeforeTheLiftCounts) {
  FlingTracker fling;
  fling.Scroll(gfx::Vector2dF(0, 200), At(0));
  fling.Scroll(gfx::Vector2dF(0, 10), At(200));
  fling.Scroll(gfx::Vector2dF(0, 10), At(210));
  fling.Scroll(gfx::Vector2dF(0, 10), At(220));
  EXPECT_FLOAT_EQ(fling.Release(At(230)).y(), 1000);
}

TEST(FlingTrackerTest, FingersThatRestBeforeLiftingDoNotGlide) {
  FlingTracker fling;
  fling.Scroll(gfx::Vector2dF(0, 10), At(0));
  fling.Scroll(gfx::Vector2dF(0, 10), At(10));
  EXPECT_TRUE(fling.Release(At(200)).IsZero());
}

TEST(FlingTrackerTest, OneEventHasNoSpeed) {
  FlingTracker fling;
  fling.Scroll(gfx::Vector2dF(0, 10), At(0));
  EXPECT_TRUE(fling.Release(At(5)).IsZero());
}

TEST(FlingTrackerTest, ALiftEndsTheGesture) {
  FlingTracker fling;
  fling.Scroll(gfx::Vector2dF(0, 10), At(0));
  fling.Scroll(gfx::Vector2dF(0, 10), At(10));
  EXPECT_FALSE(fling.Release(At(15)).IsZero());
  EXPECT_TRUE(fling.Release(At(16)).IsZero());
}

}  // namespace
}  // namespace ui
