// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_holds.h"

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(SurfaceHoldsTest, ABufferVizNeverHadGoesAtOnce) {
  SurfaceHolds holds;
  EXPECT_TRUE(holds.Destroyed(/*buffer=*/1));
}

// A client may destroy a buffer viz still draws, such as its old-size buffers
// on resize. Dropped then, viz draws its fallback image in its place.
TEST(SurfaceHoldsTest, ABufferVizHoldsGoesOnceVizReturnsIt) {
  SurfaceHolds holds;
  holds.Sent(/*buffer=*/1);
  EXPECT_FALSE(holds.Destroyed(1));
  EXPECT_EQ(holds.Returned(1, /*count=*/1), SurfaceHolds::Return::kDestroy);
}

TEST(SurfaceHoldsTest, AReturnedBufferTheClientKeepsIsReleased) {
  SurfaceHolds holds;
  holds.Sent(/*buffer=*/1);
  EXPECT_EQ(holds.Returned(1, /*count=*/1), SurfaceHolds::Return::kRelease);
  EXPECT_TRUE(holds.Destroyed(1));
}

// Viz returns a buffer once per run of holds, so one sent after a return
// still holds it.
TEST(SurfaceHoldsTest, ADestroyedBufferWaitsForEveryHold) {
  SurfaceHolds holds;
  holds.Sent(/*buffer=*/1);
  holds.Sent(1);
  EXPECT_FALSE(holds.Destroyed(1));
  EXPECT_EQ(holds.Returned(1, /*count=*/1), SurfaceHolds::Return::kKeep);
  EXPECT_EQ(holds.Returned(1, /*count=*/1), SurfaceHolds::Return::kDestroy);
}

}  // namespace
}  // namespace domicile
