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

// A shell's page, somewhere in its window's root: the whole window less
// whatever frame is above it. The offset is the point -- a page's own
// coordinates start at the page, and the cursor's start at the window.
constexpr gfx::Rect kPage(40, 60, 800, 600);

TEST(PointerWarpTest, APagePointIsThatPointInTheWindow) {
  EXPECT_EQ(PointerWarpTarget(kPage, 100, 200), gfx::Point(140, 260));
}

TEST(PointerWarpTest, AFractionOfAPixelLandsOnTheNearestOne) {
  // A CSS pixel is fractional and a cursor is not: the middle of a window of
  // an odd number of pixels is a half, which is where every warp this serves
  // is aimed.
  EXPECT_EQ(PointerWarpTarget(kPage, 100.5, 200.5), gfx::Point(141, 261));
}

TEST(PointerWarpTest, APageCannotPutTheCursorOutsideItsOwnWindow) {
  // THE ONE RULE HERE THAT IS NOT ARITHMETIC. What a page asks for is where
  // the pointer goes, and a page asking for somewhere it does not occupy is
  // asking to move the cursor onto another window or another monitor. The
  // shell's own coordinates never leave its window; a renderer's can say
  // anything at all, and the browser process is not the renderer's to trust.
  EXPECT_EQ(PointerWarpTarget(kPage, -500, 200), gfx::Point(40, 260));
  EXPECT_EQ(PointerWarpTarget(kPage, 10'000, 200), gfx::Point(839, 260));
  EXPECT_EQ(PointerWarpTarget(kPage, 100, 10'000), gfx::Point(140, 659));
}

TEST(PointerWarpTest, TheFarEdgeIsTheLastPixelAndNotThePixelAfterIt) {
  // `right()` is one past the window, which is the first pixel of whatever is
  // next to it -- a place the pointer must not be put, and on a desk of two
  // monitors a different screen.
  EXPECT_EQ(PointerWarpTarget(kPage, 800, 600), gfx::Point(839, 659));
}

TEST(PointerWarpTest, NothingThatIsNotAPlaceIsOne) {
  // A double off a mojo pipe, which is not a number a shell wrote: NaN has no
  // nearest pixel, and rounding one into an int is undefined behavior rather
  // than a wrong cursor.
  EXPECT_EQ(PointerWarpTarget(kPage, std::nan(""), 200), std::nullopt);
  EXPECT_EQ(PointerWarpTarget(kPage, 100, INFINITY), std::nullopt);
}

TEST(PointerWarpTest, APageWithNoBoxHasNowhereToPutIt) {
  // A window that has not been laid out yet. Clamping into a rectangle with
  // nothing in it would answer with its corner, which is a place the page does
  // not occupy.
  EXPECT_EQ(PointerWarpTarget(gfx::Rect(), 0, 0), std::nullopt);
}

}  // namespace
}  // namespace domicile
