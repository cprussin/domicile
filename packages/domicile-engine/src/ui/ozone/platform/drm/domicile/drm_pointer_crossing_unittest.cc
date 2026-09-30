// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_pointer_crossing.h"

#include <optional>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/event_constants.h"
#include "ui/events/types/event_type.h"
#include "ui/display/display.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/ozone/public/ozone_platform.h"

namespace ui {
namespace {

constexpr gfx::AcceleratedWidget kLeft = 1;
constexpr gfx::AcceleratedWidget kRight = 2;
constexpr gfx::AcceleratedWidget kLaptop = 3;

// Two 1920x1080 monitors side by side, with no layout stated: the hardware
// decides, and the engine's own desktop is the only arrangement there is.
std::vector<PointerScreen> SideBySide() {
  return {
      {kLeft, gfx::Rect(0, 0, 1920, 1080), display::Display::ROTATE_0},
      {kRight, gfx::Rect(1920, 0, 1920, 1080), display::Display::ROTATE_0},
  };
}

const std::vector<DomicileDisplayLayout> kHardwareDecides;

// One lit connector of a profile: its CRTC's corner on the engine's desktop,
// and where the profile put it on the desktop a shell lays out in.
DomicileDisplayLayout Lit(const gfx::Point& origin, const gfx::Rect& desk) {
  return {.id = 0, .enabled = true, .origin = origin, .desk = desk};
}

void ExpectAt(const std::optional<PointerCrossing>& crossing,
              gfx::AcceleratedWidget window,
              const gfx::PointF& location) {
  ASSERT_TRUE(crossing.has_value());
  EXPECT_EQ(crossing->window, window);
  EXPECT_NEAR(crossing->location.x(), location.x(), 0.01);
  EXPECT_NEAR(crossing->location.y(), location.y(), 0.01);
}

TEST(DrmPointerCrossingTest, AMoveInsideTheScreenCrossesNothing) {
  EXPECT_FALSE(PointerCrossingFor(SideBySide(), kHardwareDecides, kLeft,
                                  gfx::PointF(1000, 500))
                   .has_value());
}

TEST(DrmPointerCrossingTest, LeavingTheRightEdgeArrivesOnTheScreenBeside) {
  // The overshoot is carried: a hand that moved five pixels past the edge is
  // five pixels into the next screen, at the height it left at.
  ExpectAt(PointerCrossingFor(SideBySide(), kHardwareDecides, kLeft,
                              gfx::PointF(1925, 500)),
           kRight, gfx::PointF(5, 500));
}

TEST(DrmPointerCrossingTest, LeavingTheLeftEdgeArrivesOnTheScreenBeside) {
  ExpectAt(PointerCrossingFor(SideBySide(), kHardwareDecides, kRight,
                              gfx::PointF(-5, 500)),
           kLeft, gfx::PointF(1915, 500));
}

TEST(DrmPointerCrossingTest, AnEdgeWithNothingBesideItHoldsThePointer) {
  EXPECT_FALSE(PointerCrossingFor(SideBySide(), kHardwareDecides, kRight,
                                  gfx::PointF(1925, 500))
                   .has_value());
  EXPECT_FALSE(PointerCrossingFor(SideBySide(), kHardwareDecides, kLeft,
                                  gfx::PointF(1000, -5))
                   .has_value());
}

// `home-office-right-two`: the laptop bottom-aligned to the left of two
// U3219Qs stood on their sides. The engine steps the CRTCs across one row;
// the profile is what says the laptop is at the bottom.
std::vector<PointerScreen> RightTwoScreens() {
  return {
      {kLaptop, gfx::Rect(0, 0, 2880, 1920), display::Display::ROTATE_0},
      {kLeft, gfx::Rect(2880, 0, 3840, 2160), display::Display::ROTATE_270},
      {kRight, gfx::Rect(6720, 0, 3840, 2160), display::Display::ROTATE_270},
  };
}

std::vector<DomicileDisplayLayout> RightTwoLayout() {
  return {
      Lit(gfx::Point(0, 0), gfx::Rect(0, 1920, 1920, 1280)),
      Lit(gfx::Point(2880, 0), gfx::Rect(1920, 0, 1800, 3200)),
      Lit(gfx::Point(6720, 0), gfx::Rect(3720, 0, 1800, 3200)),
  };
}

TEST(DrmPointerCrossingTest, APointerArrivesWhereTheProfilePlacedTheScreens) {
  // Halfway down the laptop is 2560 down the desk, which is 3072 of the
  // turned monitor's pixels -- not halfway down it, and not the top.
  // Upright (6, 3072) on a 2160x3840 screen turned `ROTATE_270`.
  ExpectAt(PointerCrossingFor(RightTwoScreens(), RightTwoLayout(), kLaptop,
                              gfx::PointF(2887.5, 960)),
           kLeft, gfx::PointF(3072, 2154));
}

TEST(DrmPointerCrossingTest, AndComesBackTheSameWay) {
  ExpectAt(PointerCrossingFor(RightTwoScreens(), RightTwoLayout(), kLeft,
                              gfx::PointF(3072, 2166)),
           kLaptop, gfx::PointF(2872.5, 960));
}

TEST(DrmPointerCrossingTest, AnEdgeWithNothingPlacedBesideItHoldsThePointer) {
  // The turned monitor's left edge above the laptop: nothing is there.
  EXPECT_FALSE(PointerCrossingFor(RightTwoScreens(), RightTwoLayout(), kLeft,
                                  gfx::PointF(1000, 2166))
                   .has_value());
}

void ExpectNear(const gfx::PointF& actual, const gfx::PointF& expected) {
  EXPECT_NEAR(actual.x(), expected.x(), 0.01);
  EXPECT_NEAR(actual.y(), expected.y(), 0.01);
}

// A window that was pressed holds the pointer after it crosses to the next
// monitor -- a float being dragged there -- and hears it where the desk has
// it, not where the engine's row does: that row puts the turned monitor's
// pixels straight after the laptop's, sideways, at the top.
TEST(DrmPointerCrossingTest, ThePressedWindowHearsThePointerWhereTheDeskHasIt) {
  // Where `APointerArrivesWhereTheProfilePlacedTheScreens` lands, which is
  // 7.5 of the laptop's pixels past its right edge, halfway down.
  ExpectNear(PointerInWindow(RightTwoScreens(), RightTwoLayout(),
                             gfx::PointF(2880 + 3072, 2154), kLaptop),
             gfx::PointF(2887.5, 960));
}

TEST(DrmPointerCrossingTest, AndOnATurnedWindowByItsTurnedEdge) {
  // Ten logical pixels onto the right-hand monitor, a thousand down, heard by
  // the one beside it: twelve of its pixels past its upright right edge, which
  // on a panel turned `ROTATE_270` is above its top.
  ExpectNear(PointerInWindow(RightTwoScreens(), RightTwoLayout(),
                             gfx::PointF(6720 + 1200, 2148), kLeft),
             gfx::PointF(1200, -12));
}

TEST(DrmPointerCrossingTest, OnItsOwnScreenThePointerIsWhereItIs) {
  ExpectNear(PointerInWindow(RightTwoScreens(), RightTwoLayout(),
                             gfx::PointF(100, 200), kLaptop),
             gfx::PointF(100, 200));
}

// A press holds the pointer in the window it landed in until the last button
// is let go -- the implicit grab X and Wayland both give, which DRM does not.
TEST(DrmPointerCrossingTest, APressHoldsThePointerInItsWindowUntilLetGo) {
  gfx::AcceleratedWidget holder = gfx::kNullAcceleratedWidget;
  holder = PointerHolderAfter(holder, kLeft, EventType::kMousePressed,
                              EF_LEFT_MOUSE_BUTTON, EF_LEFT_MOUSE_BUTTON);
  EXPECT_EQ(holder, kLeft);
  holder = PointerHolderAfter(holder, kLeft, EventType::kMouseDragged,
                              EF_LEFT_MOUSE_BUTTON, 0);
  EXPECT_EQ(holder, kLeft);
  holder = PointerHolderAfter(holder, kLeft, EventType::kMouseReleased,
                              EF_LEFT_MOUSE_BUTTON, EF_LEFT_MOUSE_BUTTON);
  EXPECT_EQ(holder, gfx::kNullAcceleratedWidget);
}

TEST(DrmPointerCrossingTest, LettingGoOfOneOfTwoButtonsStillHolds) {
  EXPECT_EQ(PointerHolderAfter(kLeft, kLeft, EventType::kMouseReleased,
                               EF_LEFT_MOUSE_BUTTON | EF_RIGHT_MOUSE_BUTTON,
                               EF_RIGHT_MOUSE_BUTTON),
            kLeft);
}

// `home-office-center`: the laptop centered under one monitor.
std::vector<PointerScreen> CenterScreens() {
  return {
      {kLeft, gfx::Rect(0, 0, 3840, 2160), display::Display::ROTATE_0},
      {kLaptop, gfx::Rect(3840, 0, 2880, 1920), display::Display::ROTATE_0},
  };
}

std::vector<DomicileDisplayLayout> CenterLayout() {
  return {
      Lit(gfx::Point(0, 0), gfx::Rect(0, 0, 3200, 1800)),
      Lit(gfx::Point(3840, 0), gfx::Rect(640, 1800, 1920, 1280)),
  };
}

TEST(DrmPointerCrossingTest, AScreenBelowIsReachedByTheBottomEdge) {
  ExpectAt(PointerCrossingFor(CenterScreens(), CenterLayout(), kLeft,
                              gfx::PointF(1920, 2166)),
           kLaptop, gfx::PointF(1440, 7.5));
}

TEST(DrmPointerCrossingTest, TheEngineRowSaysNothingAboutWhereAScreenIs) {
  // The laptop's CRTC is to the right of the monitor's, and the laptop is not.
  EXPECT_FALSE(PointerCrossingFor(CenterScreens(), CenterLayout(), kLeft,
                                  gfx::PointF(3845, 1000))
                   .has_value());
}

TEST(DrmPointerCrossingTest, AScreenTheLayoutLeavesDarkIsNeverEntered) {
  const std::vector<DomicileDisplayLayout> layout = {
      Lit(gfx::Point(0, 0), gfx::Rect(0, 0, 1920, 1080)),
      {.id = 0, .enabled = false, .origin = gfx::Point(1920, 0)},
  };
  EXPECT_FALSE(
      PointerCrossingFor(SideBySide(), layout, kLeft, gfx::PointF(1925, 500))
          .has_value());
}

TEST(DrmPointerCrossingTest, AScreenAPixelAwayIsStillBeside) {
  // A profile's positions are rounded outward, so two screens meant to touch
  // can be a logical pixel apart. A hand moving slowly would otherwise never
  // get across.
  const std::vector<DomicileDisplayLayout> layout = {
      Lit(gfx::Point(0, 0), gfx::Rect(0, 0, 1920, 1080)),
      Lit(gfx::Point(1920, 0), gfx::Rect(1921, 0, 1920, 1080)),
  };
  ExpectAt(
      PointerCrossingFor(SideBySide(), layout, kLeft, gfx::PointF(1920.5, 500)),
      kRight, gfx::PointF(0, 500));
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
