// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_geometry.h"

#include <optional>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/screen_info.h"
#include "ui/display/screen_infos.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {
namespace {

// `home-office-right-two`: a 1.5 laptop under the left edge of two 1.2 4K
// monitors turned on their sides, in the desk's logical pixels.
constexpr DeskPlace kLaptop{.id = 1,
                            .desk = gfx::Rect(0, 1920, 1920, 1280),
                            .scale = 1.5f,
                            .refresh_hz = 60.0f};
constexpr DeskPlace kCenter{.id = 2,
                            .desk = gfx::Rect(1920, 0, 1800, 3200),
                            .scale = 1.2f,
                            .refresh_hz = 144.0f};
constexpr DeskPlace kRight{.id = 3,
                           .desk = gfx::Rect(3720, 0, 1800, 3200),
                           .scale = 1.2f,
                           .refresh_hz = 60.0f};

TEST(DeskGeometryTest, ThePageIsTheBoxAroundEveryDisplay) {
  EXPECT_EQ(DeskGeometryOf({kLaptop, kCenter, kRight})->box,
            gfx::Rect(0, 0, 5520, 3200));
}

TEST(DeskGeometryTest, TheBoxStartsAtTheDesksCorner) {
  // A profile need not put anything at 0,0. The page's origin is the box's.
  const DeskPlace left{.id = 1, .desk = gfx::Rect(-100, 50, 800, 600)};
  const DeskPlace right{.id = 2, .desk = gfx::Rect(700, 80, 800, 600)};
  EXPECT_EQ(DeskGeometryOf({left, right})->box, gfx::Rect(-100, 50, 1600, 630));
}

TEST(DeskGeometryTest, ThePageIsLaidOutAtTheLargestScale) {
  // The denser display has the most to lose from an edge snapped for another.
  EXPECT_EQ(DeskGeometryOf({kCenter, kLaptop, kRight})->scale, 1.5f);
}

TEST(DeskGeometryTest, TheFastestDisplayHostsThePage) {
  // Its BeginFrames drive the page, and a slower one would stutter it.
  EXPECT_EQ(DeskGeometryOf({kLaptop, kCenter, kRight})->host, kCenter.id);
}

TEST(DeskGeometryTest, OfEquallyFastDisplaysTheFirstHosts) {
  // The first is the primary, the one startup's window is already on.
  EXPECT_EQ(DeskGeometryOf({kRight, kLaptop})->host, kRight.id);
}

TEST(DeskGeometryTest, NoDisplaysIsNoDesk) {
  EXPECT_EQ(DeskGeometryOf({}), std::nullopt);
}

TEST(DeskGeometryTest, EachDisplayShowsThePageFromItsOwnCorner) {
  // In that display's logical pixels, which is what its window's layers are
  // in: the page's origin sits up and to the left of the display's own.
  const gfx::Rect box(0, 0, 5520, 3200);
  EXPECT_EQ(PageBoundsOn(kLaptop, box), gfx::Rect(0, -1920, 5520, 3200));
  EXPECT_EQ(PageBoundsOn(kRight, box), gfx::Rect(-3720, 0, 5520, 3200));
}

TEST(DeskGeometryTest, ThePageIsToldOneScreenTheSizeOfTheDesk) {
  display::ScreenInfo like;
  like.depth = 30;
  like.orientation_angle = 270;
  const display::ScreenInfos told =
      DeskScreenInfos(*DeskGeometryOf({kLaptop, kCenter, kRight}), like);

  ASSERT_EQ(told.screen_infos.size(), 1u);
  const display::ScreenInfo& desk = told.current();
  EXPECT_EQ(desk.rect, gfx::Rect(0, 0, 5520, 3200));
  EXPECT_EQ(desk.available_rect, gfx::Rect(0, 0, 5520, 3200));
  EXPECT_EQ(desk.device_scale_factor, 1.5f);
  EXPECT_EQ(desk.display_id, kCenter.id);
  // What the page is on is not turned: every turn is a presenter's.
  EXPECT_EQ(desk.orientation_angle, 0);
  // The rest is the host display's.
  EXPECT_EQ(desk.depth, 30);
}

}  // namespace
}  // namespace domicile
