// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_pointer_crossing.h"

#include <optional>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"

namespace ui {
namespace {

constexpr gfx::AcceleratedWidget kLeft = 1;
constexpr gfx::AcceleratedWidget kRight = 2;
constexpr gfx::AcceleratedWidget kDark = 3;

// Two 1920x1080 monitors in the row the compositor steps connectors across.
std::vector<PointerScreen> SideBySide() {
  return {
      {kLeft, gfx::Rect(0, 0, 1920, 1080), display::Display::ROTATE_0},
      {kRight, gfx::Rect(1920, 0, 1920, 1080), display::Display::ROTATE_0},
  };
}

TEST(DrmPointerCrossingTest, AMoveInsideTheScreenCrossesNothing) {
  EXPECT_FALSE(PointerCrossingFor(SideBySide(), kLeft, gfx::PointF(1000, 500))
                   .has_value());
}

TEST(DrmPointerCrossingTest, LeavingTheRightEdgeArrivesOnTheScreenBeside) {
  const std::optional<PointerCrossing> crossing =
      PointerCrossingFor(SideBySide(), kLeft, gfx::PointF(1925, 500));
  ASSERT_TRUE(crossing.has_value());
  EXPECT_EQ(crossing->window, kRight);
  // The overshoot is carried: a hand that moved five pixels past the edge is
  // five pixels into the next screen, at the height it left at.
  EXPECT_EQ(crossing->location, gfx::PointF(5, 500));
}

TEST(DrmPointerCrossingTest, LeavingTheLeftEdgeArrivesOnTheScreenBeside) {
  const std::optional<PointerCrossing> crossing =
      PointerCrossingFor(SideBySide(), kRight, gfx::PointF(-5, 500));
  ASSERT_TRUE(crossing.has_value());
  EXPECT_EQ(crossing->window, kLeft);
  EXPECT_EQ(crossing->location, gfx::PointF(1915, 500));
}

TEST(DrmPointerCrossingTest, AnEdgeWithNothingBesideItHoldsThePointer) {
  EXPECT_FALSE(PointerCrossingFor(SideBySide(), kRight, gfx::PointF(1925, 500))
                   .has_value());
}

TEST(DrmPointerCrossingTest, TheTopAndBottomEdgesCrossNothing) {
  // The row is all the engine has; a desk stacked vertically is not in it.
  EXPECT_FALSE(PointerCrossingFor(SideBySide(), kLeft, gfx::PointF(1000, -5))
                   .has_value());
  EXPECT_FALSE(PointerCrossingFor(SideBySide(), kLeft, gfx::PointF(1000, 1085))
                   .has_value());
}

TEST(DrmPointerCrossingTest, AScreenPastAGapIsNotBeside) {
  // Where the compositor puts the connectors a profile turned off, so a
  // pointer cannot wander onto a panel that is dark.
  const std::vector<PointerScreen> screens = {
      {kLeft, gfx::Rect(0, 0, 1920, 1080), display::Display::ROTATE_0},
      {kDark, gfx::Rect(1921, 0, 1920, 1080), display::Display::ROTATE_0},
  };
  EXPECT_FALSE(
      PointerCrossingFor(screens, kLeft, gfx::PointF(1925, 500)).has_value());
}

TEST(DrmPointerCrossingTest, ATurnedScreenIsLeftByItsUprightEdge) {
  // A 3840x2160 panel stood on its side: `rotate-270` in a profile, which is
  // `ROTATE_90`. Its CRTC is still landscape in the row; what a hand calls
  // the right edge is the panel's bottom.
  const std::vector<PointerScreen> screens = {
      {kLeft, gfx::Rect(0, 0, 3840, 2160), display::Display::ROTATE_90},
      {kRight, gfx::Rect(3840, 0, 3840, 2160), display::Display::ROTATE_90},
  };
  // Leaving the panel's right is the upright top, which crosses nothing.
  EXPECT_FALSE(
      PointerCrossingFor(screens, kLeft, gfx::PointF(3845, 1000)).has_value());

  // Upright, (2165, 1000) on a 2160x3840 screen: five past the right edge,
  // a thousand down.
  const std::optional<PointerCrossing> crossing =
      PointerCrossingFor(screens, kLeft, gfx::PointF(2840, 2165));
  ASSERT_TRUE(crossing.has_value());
  EXPECT_EQ(crossing->window, kRight);
  // Five into the next upright screen, a thousand down, back on its panel.
  EXPECT_EQ(crossing->location, gfx::PointF(2840, 5));
}

TEST(DrmPointerCrossingTest, AHeightIsKeptAcrossScreensTurnedDifferently) {
  const std::vector<PointerScreen> screens = {
      {kLeft, gfx::Rect(0, 0, 1920, 1080), display::Display::ROTATE_0},
      {kRight, gfx::Rect(1920, 0, 1920, 1080), display::Display::ROTATE_270},
  };
  const std::optional<PointerCrossing> crossing =
      PointerCrossingFor(screens, kLeft, gfx::PointF(1925, 500));
  ASSERT_TRUE(crossing.has_value());
  EXPECT_EQ(crossing->window, kRight);
  // Upright (5, 500) on a 1080x1920 screen turned `ROTATE_270`.
  EXPECT_EQ(crossing->location, gfx::PointF(500, 1075));
}

TEST(DrmPointerCrossingTest, AScreenTurnedOverIsLeftByItsLeftPanelEdge) {
  const std::vector<PointerScreen> screens = {
      {kLeft, gfx::Rect(0, 0, 1920, 1080), display::Display::ROTATE_180},
      {kRight, gfx::Rect(1920, 0, 1920, 1080), display::Display::ROTATE_0},
  };
  const std::optional<PointerCrossing> crossing =
      PointerCrossingFor(screens, kLeft, gfx::PointF(-5, 580));
  ASSERT_TRUE(crossing.has_value());
  EXPECT_EQ(crossing->window, kRight);
  EXPECT_EQ(crossing->location, gfx::PointF(5, 500));
}

TEST(DrmPointerCrossingTest, TheKeyboardIsOnTheScreenThePointerIsOn) {
  EXPECT_TRUE(
      HasTheKeyboard(gfx::Rect(1920, 0, 1920, 1080), gfx::PointF(1920.5, 500)));
  EXPECT_FALSE(
      HasTheKeyboard(gfx::Rect(0, 0, 1920, 1080), gfx::PointF(1920.5, 500)));
}

TEST(DrmPointerCrossingTest, TheKeyboardEdgeIsTheClickEdge) {
  // Floored the way a click's location is, so the last column of a screen
  // takes the keys as it takes the click.
  EXPECT_TRUE(
      HasTheKeyboard(gfx::Rect(0, 0, 1920, 1080), gfx::PointF(1919.9, 500)));
}

}  // namespace
}  // namespace ui
