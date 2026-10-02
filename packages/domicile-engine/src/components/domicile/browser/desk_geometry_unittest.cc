// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_geometry.h"

#include <optional>
#include <vector>

#include "cc/domicile/display_regions.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/screen_info.h"
#include "ui/display/screen_infos.h"
#include "ui/gfx/geometry/point.h"
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
      DeskScreenInfos(*DeskGeometryOf({kLaptop, kCenter, kRight}),
                      {kLaptop, kCenter, kRight}, like);

  ASSERT_EQ(told.screen_infos.size(), 4u);
  EXPECT_EQ(&told.current(), &told.screen_infos.front());
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

TEST(DeskGeometryTest, ThePageIsToldEveryMonitorItIsShownOn) {
  // Each at its own density, from the desk's corner, so that the page can
  // raster its part of every one natively: see cc/domicile/display_regions.h.
  const DeskPlace left{
      .id = 1, .desk = gfx::Rect(-100, 50, 800, 600), .scale = 1.0f};
  const DeskPlace right{
      .id = 2, .desk = gfx::Rect(700, 80, 800, 600), .scale = 2.0f};
  const display::ScreenInfos told =
      DeskScreenInfos(*DeskGeometryOf({left, right}), {left, right}, {});

  ASSERT_EQ(told.screen_infos.size(), 3u);
  const display::ScreenInfo& shows_left = told.screen_infos[1];
  EXPECT_EQ(shows_left.rect, gfx::Rect(0, 0, 800, 600));
  EXPECT_EQ(shows_left.device_scale_factor, 1.0f);
  EXPECT_EQ(shows_left.label, cc::kDomicileDisplayLabel);
  const display::ScreenInfo& shows_right = told.screen_infos[2];
  EXPECT_EQ(shows_right.rect, gfx::Rect(800, 30, 800, 600));
  EXPECT_EQ(shows_right.device_scale_factor, 2.0f);
  EXPECT_EQ(shows_right.label, cc::kDomicileDisplayLabel);
  // Not the screen the page is on, which has the host's id: every id once.
  EXPECT_NE(shows_left.display_id, told.current_display_id);
  EXPECT_NE(shows_right.display_id, told.current_display_id);
  EXPECT_NE(shows_left.display_id, shows_right.display_id);
}

TEST(DeskGeometryTest, AWarpOnTheHostLandsOnTheHost) {
  EXPECT_EQ(WarpLandsOn({kLaptop, kCenter, kRight}, kLaptop.id,
                        gfx::Point(100, 100)),
            kLaptop.id);
}

TEST(DeskGeometryTest, AWarpPastTheHostsEdgeLandsOnTheMonitorThere) {
  // From the laptop's corner, up and to the right: on the turned monitors,
  // whose arrow is drawn turned and at their density, not the laptop's.
  const std::vector<DeskPlace> lit{kLaptop, kCenter, kRight};
  EXPECT_EQ(WarpLandsOn(lit, kLaptop.id, gfx::Point(3000, -1000)), kCenter.id);
  EXPECT_EQ(WarpLandsOn(lit, kLaptop.id, gfx::Point(4000, -1000)), kRight.id);
}

TEST(DeskGeometryTest, AWarpOntoNoMonitorStaysOnTheHost) {
  // Above the laptop and left of the center monitor is no screen at all, and
  // the cursor does not cross onto nothing.
  EXPECT_EQ(WarpLandsOn({kLaptop, kCenter, kRight}, kLaptop.id,
                        gfx::Point(100, -100)),
            kLaptop.id);
}

TEST(DeskGeometryTest, AWarpFromOffTheDeskIsNotTheDesks) {
  EXPECT_EQ(WarpLandsOn({kCenter, kRight}, kLaptop.id, gfx::Point(100, 100)),
            std::nullopt);
}

}  // namespace
}  // namespace domicile
