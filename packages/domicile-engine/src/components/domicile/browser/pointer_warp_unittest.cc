// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/pointer_warp.h"

#include <cmath>
#include <optional>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {
namespace {

// A shell page offset within its window, so page and window coordinates
// differ.
constexpr gfx::Rect kPage(40, 60, 800, 600);

TEST(PointerWarpTest, APagePointIsThatPointInTheWindow) {
  EXPECT_EQ(PointerWarpTarget(kPage, 100, 200), gfx::Point(140, 260));
}

TEST(PointerWarpTest, AFractionOfAPixelLandsOnTheNearestOne) {
  // The center of an odd-sized window is a half pixel.
  EXPECT_EQ(PointerWarpTarget(kPage, 100.5, 200.5), gfx::Point(141, 261));
}

TEST(PointerWarpTest, APageCannotPutTheCursorOutsideItsOwnWindow) {
  // The browser does not trust the renderer, so a page cannot move the cursor
  // onto another window or monitor.
  EXPECT_EQ(PointerWarpTarget(kPage, -500, 200), gfx::Point(40, 260));
  EXPECT_EQ(PointerWarpTarget(kPage, 10'000, 200), gfx::Point(839, 260));
  EXPECT_EQ(PointerWarpTarget(kPage, 100, 10'000), gfx::Point(140, 659));
}

TEST(PointerWarpTest, TheFarEdgeIsTheLastPixelAndNotThePixelAfterIt) {
  // `right()` is one past the window and may be on another monitor.
  EXPECT_EQ(PointerWarpTarget(kPage, 800, 600), gfx::Point(839, 659));
}

TEST(PointerWarpTest, NothingThatIsNotAPlaceIsOne) {
  // Rounding NaN or infinity to an int is undefined behavior.
  EXPECT_EQ(PointerWarpTarget(kPage, std::nan(""), 200), std::nullopt);
  EXPECT_EQ(PointerWarpTarget(kPage, 100, INFINITY), std::nullopt);
}

TEST(PointerWarpTest, APageWithNoBoxHasNowhereToPutIt) {
  // A window not yet laid out. Clamping would return a corner the page does
  // not occupy.
  EXPECT_EQ(PointerWarpTarget(gfx::Rect(), 0, 0), std::nullopt);
}

}  // namespace
}  // namespace domicile
