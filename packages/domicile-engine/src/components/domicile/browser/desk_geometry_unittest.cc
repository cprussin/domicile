// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/desk_geometry.h"

#include <stdint.h>

#include <optional>
#include <vector>

#include "cc/domicile/display_regions.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display.h"
#include "ui/display/screen_info.h"
#include "ui/display/screen_infos.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {
namespace {

// `home-office-right-two`: a 1.5x laptop below the left edge of two rotated
// 1.2x 4K monitors, in desk logical pixels.
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

// Displays with these ids, at no particular place.
std::vector<display::Display> PluggedIn(const std::vector<int64_t>& ids) {
  std::vector<display::Display> displays;
  for (const int64_t id : ids) {
    displays.emplace_back(id);
  }
  return displays;
}

TEST(DeskGeometryTest, ThePageIsTheBoxAroundEveryDisplay) {
  EXPECT_EQ(DeskGeometryOf({kLaptop, kCenter, kRight})->box,
            gfx::Rect(0, 0, 5520, 3200));
}

TEST(DeskGeometryTest, TheBoxStartsAtTheDesksCorner) {
  // A profile need not use 0,0; the page's origin is the box's.
  const DeskPlace left{.id = 1, .desk = gfx::Rect(-100, 50, 800, 600)};
  const DeskPlace right{.id = 2, .desk = gfx::Rect(700, 80, 800, 600)};
  EXPECT_EQ(DeskGeometryOf({left, right})->box, gfx::Rect(-100, 50, 1600, 630));
}

TEST(DeskGeometryTest, ThePageIsLaidOutAtTheLargestScale) {
  // The densest display would lose the most sharpness at a lower scale.
  EXPECT_EQ(DeskGeometryOf({kCenter, kLaptop, kRight})->scale, 1.5f);
}

TEST(DeskGeometryTest, TheFastestDisplayHostsThePage) {
  // Its BeginFrames drive the page; a slower one would make it stutter.
  EXPECT_EQ(DeskGeometryOf({kLaptop, kCenter, kRight})->host, kCenter.id);
}

TEST(DeskGeometryTest, OfEquallyFastDisplaysTheFirstHosts) {
  // The first is the primary, where the startup window already is.
  EXPECT_EQ(DeskGeometryOf({kRight, kLaptop})->host, kRight.id);
}

TEST(DeskGeometryTest, NoDisplaysIsNoDesk) {
  EXPECT_EQ(DeskGeometryOf({}), std::nullopt);
}

TEST(DeskGeometryTest, ALayoutThatLightsDisplaysIsTheDesk) {
  EXPECT_EQ(DeskPlacesKept(std::vector<DeskPlace>({kLaptop, kRight}),
                           {kLaptop, kCenter, kRight},
                           PluggedIn({kLaptop.id, kCenter.id, kRight.id})),
            std::vector<DeskPlace>({kLaptop, kRight}));
}

TEST(DeskGeometryTest, AnEmptyLayoutPutsTheDeskWhereTheHardwarePutTheDisplays) {
  // No profile: the compositor advertises each display at its CRTC
  // rectangle, unscaled. A profile's desk from before does not stay.
  display::Display left(1, gfx::Rect(0, 0, 1280, 800));
  left.set_display_frequency(74.99385f);
  display::Display right(2, gfx::Rect(1280, 0, 1440, 900));
  right.set_display_frequency(74.99458f);
  EXPECT_EQ(DeskPlacesKept(std::nullopt, {kLaptop, kCenter}, {left, right}),
            std::vector<DeskPlace>({{.id = 1,
                                     .desk = gfx::Rect(0, 0, 1280, 800),
                                     .scale = 1.0f,
                                     .refresh_hz = 74.99385f},
                                    {.id = 2,
                                     .desk = gfx::Rect(1280, 0, 1440, 900),
                                     .scale = 1.0f,
                                     .refresh_hz = 74.99458f}}));
}

TEST(DeskGeometryTest, ABlankKeepsTheDeskItTurnedOff) {
  // Laying the desk out again on the primary would move the page to a new
  // window and drop every presenter, then do it all again on waking.
  EXPECT_EQ(DeskPlacesKept(std::vector<DeskPlace>(), {kLaptop, kCenter, kRight},
                           PluggedIn({kLaptop.id, kCenter.id, kRight.id})),
            std::vector<DeskPlace>({kLaptop, kCenter, kRight}));
}

TEST(DeskGeometryTest, AMonitorUnpluggedDuringABlankLeavesTheDesk) {
  // Its window would sit on a display that is gone.
  EXPECT_EQ(DeskPlacesKept(std::vector<DeskPlace>(), {kLaptop, kCenter, kRight},
                           PluggedIn({kLaptop.id, kRight.id})),
            std::vector<DeskPlace>({kLaptop, kRight}));
}

TEST(DeskGeometryTest, BeforeAnyLayoutThereIsNoDesk) {
  EXPECT_TRUE(
      DeskPlacesKept(std::vector<DeskPlace>(), {}, PluggedIn({kLaptop.id}))
          .empty());
}

TEST(DeskGeometryTest, EachDisplayShowsThePageFromItsOwnCorner) {
  // In the display's logical pixels, so the page's origin is above and left
  // of the display's.
  const gfx::Rect box(0, 0, 5520, 3200);
  EXPECT_EQ(PageBoundsOn(kLaptop, box), gfx::Rect(0, -1920, 5520, 3200));
  EXPECT_EQ(PageBoundsOn(kRight, box), gfx::Rect(-3720, 0, 5520, 3200));
}

TEST(DeskGeometryTest, APopupIsShownWhereItsPageIsOnAnotherMonitor) {
  // A <select> at desk (300, 2000), on the laptop, opens its list in the
  // center monitor's window, which hosts the page.
  const gfx::Rect box(0, 0, 5520, 3200);
  const gfx::Rect page_on_host = PageBoundsOn(kCenter, box);
  EXPECT_EQ(PopupBoundsOn(gfx::Rect(-1620, 2000, 200, 300), page_on_host,
                          PageBoundsOn(kLaptop, box)),
            gfx::Rect(300, 80, 200, 300));
}

TEST(DeskGeometryTest, APopupOnTheHostIsOffEveryOtherMonitor) {
  const gfx::Rect box(0, 0, 5520, 3200);
  const gfx::Rect page_on_host = PageBoundsOn(kCenter, box);
  EXPECT_FALSE(PopupBoundsOn(gfx::Rect(100, 100, 200, 300), page_on_host,
                             PageBoundsOn(kRight, box))
                   .Intersects(gfx::Rect(kRight.desk.size())));
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
  // The page's screen is upright; presenters apply rotation.
  EXPECT_EQ(desk.orientation_angle, 0);
  // Other fields come from the host display.
  EXPECT_EQ(desk.depth, 30);
}

TEST(DeskGeometryTest, ThePageIsToldEveryMonitorItIsShownOn) {
  // Each at its own scale, offset from the desk's corner, so the page can
  // raster each region natively. See cc/domicile/display_regions.h.
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
  // Ids are unique, so this differs from the page screen's host id.
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
  // Up and right of the laptop's corner is a rotated monitor.
  const std::vector<DeskPlace> lit{kLaptop, kCenter, kRight};
  EXPECT_EQ(WarpLandsOn(lit, kLaptop.id, gfx::Point(3000, -1000)), kCenter.id);
  EXPECT_EQ(WarpLandsOn(lit, kLaptop.id, gfx::Point(4000, -1000)), kRight.id);
}

TEST(DeskGeometryTest, AWarpOntoNoMonitorStaysOnTheHost) {
  // Above the laptop and left of the center monitor there is no screen.
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
