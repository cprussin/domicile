// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/spike/window_diff.h"

#include <cstdint>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace domicile::spike {
namespace {

// Tests the comparison behind the CSS parity verdicts. See
// docs/architecture/ENGINE-FORK-MEASUREMENTS.md#css-parity.

constexpr SkColor kBackground = SkColorSetARGB(0xFF, 0x10, 0x14, 0x18);
constexpr SkColor kApp = SkColorSetARGB(0xFF, 0x00, 0xC8, 0x53);
constexpr int kTolerance = 4;
constexpr int kEdgeRadius = 2;

// A window filled with `fill`, which callers paint into.
class Painter {
 public:
  Painter(int width, int height, SkColor fill)
      : size_(width, height),
        pixels_(static_cast<size_t>(width) * height, fill) {}

  void Fill(const gfx::Rect& rect, SkColor color) {
    for (int y = rect.y(); y < rect.bottom(); ++y) {
      for (int x = rect.x(); x < rect.right(); ++x) {
        pixels_[static_cast<size_t>(y) * size_.width() + x] = color;
      }
    }
  }

  WindowCapture Capture() const { return WindowCapture(size_, pixels_); }

 private:
  gfx::Size size_;
  std::vector<uint32_t> pixels_;
};

// The two halves to compare: a 20x20 rect at x=0 and at x=40 of a 60x20
// window.
constexpr gfx::Rect kLeft(0, 0, 20, 20);
constexpr gfx::Point kRightOrigin(40, 0);

RectDiff Diff(const Painter& painter) {
  return DiffRects(painter.Capture(), kLeft, kRightOrigin, kTolerance,
                   kEdgeRadius);
}

TEST(WindowDiffTest, TwoHalvesPaintedTheSameDoNotDiffer) {
  Painter painter(60, 20, kBackground);
  painter.Fill(gfx::Rect(5, 5, 10, 10), kApp);
  painter.Fill(gfx::Rect(45, 5, 10, 10), kApp);

  const RectDiff diff = Diff(painter);

  EXPECT_EQ(diff.compared, 400);
  EXPECT_EQ(diff.mismatched, 0);
  EXPECT_EQ(diff.interior_mismatched, 0);
}

// A resampled surface and a rasterized element differ in the low bits.
TEST(WindowDiffTest, ChannelsWithinToleranceDoNotCountAsDiffering) {
  Painter painter(60, 20, kBackground);
  painter.Fill(gfx::Rect(5, 5, 10, 10), kApp);
  painter.Fill(gfx::Rect(45, 5, 10, 10),
               SkColorSetARGB(0xFF, 0x00 + kTolerance, 0xC8, 0x53));

  const RectDiff diff = Diff(painter);

  EXPECT_EQ(diff.mismatched, 0);
  EXPECT_EQ(diff.worst_delta, kTolerance);
}

// As in the `transform` cell: differences only along the box's boundary.
TEST(WindowDiffTest, AnOutlineOfDifferencesHasNoInterior) {
  Painter painter(60, 20, kBackground);
  painter.Fill(gfx::Rect(5, 5, 10, 10), kApp);
  painter.Fill(gfx::Rect(45, 5, 10, 10), kApp);
  // One pixel all the way round the left box, and nothing on the right.
  painter.Fill(gfx::Rect(5, 5, 10, 1), SK_ColorRED);
  painter.Fill(gfx::Rect(5, 14, 10, 1), SK_ColorRED);
  painter.Fill(gfx::Rect(5, 5, 1, 10), SK_ColorRED);
  painter.Fill(gfx::Rect(14, 5, 1, 10), SK_ColorRED);

  const RectDiff diff = Diff(painter);

  EXPECT_GT(diff.mismatched, 0);
  EXPECT_EQ(diff.interior_mismatched, 0);
}

// A property that does not apply to an <app> leaves a whole region different.
TEST(WindowDiffTest, AFilledRegionOfDifferencesHasAnInterior) {
  Painter painter(60, 20, kBackground);
  painter.Fill(gfx::Rect(5, 5, 10, 10), kApp);
  painter.Fill(gfx::Rect(45, 5, 10, 10), SK_ColorRED);

  const RectDiff diff = Diff(painter);

  EXPECT_EQ(diff.mismatched, 100);
  // The 10x10 block minus its two-pixel border.
  EXPECT_EQ(diff.interior_mismatched, 36);
}

// A difference 2 * kEdgeRadius pixels across is all edge; one pixel wider has
// an interior.
TEST(WindowDiffTest, InteriorBeginsBeyondTheEdgeRadius) {
  Painter painter(60, 20, kBackground);
  painter.Fill(gfx::Rect(5, 5, 2 * kEdgeRadius + 1, 2 * kEdgeRadius + 1),
               SK_ColorRED);
  EXPECT_EQ(Diff(painter).interior_mismatched, 1);

  Painter narrower(60, 20, kBackground);
  narrower.Fill(gfx::Rect(5, 5, 2 * kEdgeRadius, 2 * kEdgeRadius),
                SK_ColorRED);
  EXPECT_EQ(Diff(narrower).interior_mismatched, 0);
}

TEST(WindowDiffTest, TheViewportStartsAtTheFirstFullyBackgroundRow) {
  Painter painter(60, 20, kBackground);
  // Rows 0 to 2 are browser chrome, and row 3 has one non-background pixel.
  painter.Fill(gfx::Rect(0, 0, 60, 3), SK_ColorWHITE);
  painter.Fill(gfx::Rect(59, 3, 1, 1), SK_ColorWHITE);

  EXPECT_EQ(painter.Capture().FindViewportTop(kBackground, kTolerance), 4);
}

// A page that did not load, or has unexpected colors. A nearest match would
// misalign every cell, so there is no fallback.
TEST(WindowDiffTest, NoBackgroundRowIsNotAViewport) {
  Painter painter(60, 20, SK_ColorWHITE);

  EXPECT_EQ(painter.Capture().FindViewportTop(kBackground, kTolerance), -1);
}

}  // namespace
}  // namespace domicile::spike
