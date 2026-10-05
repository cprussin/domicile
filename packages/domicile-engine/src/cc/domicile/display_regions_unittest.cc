// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "cc/domicile/display_regions.h"

#include <cstddef>
#include <limits>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/transform.h"

namespace cc {
namespace {

// A desk at 2x: a 1.5x monitor on the left, the 2x one beside it and a 1x
// one under that. The page is the box around all three, in device pixels at 2.
DomicileDisplayRegions Desk() {
  return {
      {gfx::Rect(0, 0, 2880, 1800), 0.75f},
      {gfx::Rect(5760, 1800, 3840, 2160), 0.5f},
  };
}

TEST(DomicileDisplayRegionsTest, EveryLessDenseMonitorIsARegion) {
  // The desk above, as the browser tells the page: placed at (500, 0) on the
  // engine's screen, a 1.5x monitor, the 2x one and a 1x one.
  const std::vector<DomicileDisplay> displays = {
      {gfx::Rect(500, 0, 1440, 900), 1.5f},
      {gfx::Rect(1940, 0, 1440, 900), 2.f},
      {gfx::Rect(3380, 900, 1920, 1080), 1.f},
  };
  EXPECT_EQ(DomicileDisplayRegionsOf(displays, gfx::Point(500, 0), 2.f),
            Desk());
}

TEST(DomicileDisplayRegionsTest, AWidgetInThePageHasTheRegionsWhereItIs) {
  // A <webview> 100 DIPs in and 50 down from the page's corner.
  const std::vector<DomicileDisplay> displays = {
      {gfx::Rect(0, 0, 1440, 900), 1.5f},
  };
  EXPECT_EQ(
      DomicileDisplayRegionsOf(displays, gfx::Point(100, 50), 2.f),
      DomicileDisplayRegions({{gfx::Rect(-200, -100, 2880, 1800), 0.75f}}));
}

TEST(DomicileDisplayRegionsTest, AWidgetOnMonitorsAsDenseAsItHasNone) {
  const std::vector<DomicileDisplay> displays = {
      {gfx::Rect(0, 0, 1440, 900), 2.f},
  };
  EXPECT_TRUE(DomicileDisplayRegionsOf(displays, gfx::Point(), 2.f).empty());
}

TEST(DomicileDisplayRegionsTest, ALayerOnOneMonitorHasItsRatioOnly) {
  EXPECT_EQ(DomicileRatiosMeeting(Desk(), gfx::Rect(100, 100, 400, 400)),
            std::vector<float>({0.75f}));
}

TEST(DomicileDisplayRegionsTest, ALayerAcrossMonitorsHasEachRatioAscending) {
  EXPECT_EQ(DomicileRatiosMeeting(Desk(), gfx::Rect(0, 0, 9600, 3960)),
            std::vector<float>({0.5f, 0.75f}));
}

TEST(DomicileDisplayRegionsTest, ALayerOnTheDensestMonitorHasNone) {
  EXPECT_TRUE(
      DomicileRatiosMeeting(Desk(), gfx::Rect(3000, 0, 400, 400)).empty());
}

TEST(DomicileDisplayRegionsTest, ALayerOnMoreDensitiesThanTilingsHasTheLeast) {
  const DomicileDisplayRegions four = {
      {gfx::Rect(0, 0, 100, 100), 0.75f},
      {gfx::Rect(100, 0, 100, 100), 0.5f},
      {gfx::Rect(200, 0, 100, 100), 0.6f},
      {gfx::Rect(300, 0, 100, 100), 0.4f},
  };
  EXPECT_EQ(DomicileRatiosMeeting(four, gfx::Rect(0, 0, 400, 100)),
            std::vector<float>({0.4f, 0.5f, 0.6f}));
}

TEST(DomicileDisplayRegionsTest, TwoMonitorsOfOneDensityAreOneRatio) {
  const DomicileDisplayRegions twins = {
      {gfx::Rect(0, 0, 100, 100), 0.5f},
      {gfx::Rect(200, 0, 100, 100), 0.5f},
  };
  EXPECT_EQ(DomicileRatiosMeeting(twins, gfx::Rect(0, 0, 300, 100)),
            std::vector<float>({0.5f}));
}

TEST(DomicileDisplayRegionsTest, ARegionIsFoundInTheLayersOwnSpace) {
  gfx::Transform to_target;
  to_target.Translate(-100, 50);
  to_target.Scale(2, 2);
  // The 1.5x monitor's (0,0 2880x1800) is (50,-25 1440x900) in a layer at
  // twice the target's scale, moved left 100 and down 50.
  EXPECT_EQ(DomicileRegionInLayer(Desk(), 0.75f, to_target),
            gfx::Rect(50, -25, 1440, 900));
}

TEST(DomicileDisplayRegionsTest, ATurnedLayerHasNoRegion) {
  gfx::Transform turned;
  turned.Rotate(30);
  EXPECT_TRUE(DomicileRegionInLayer(Desk(), 0.75f, turned).IsEmpty());
}

TEST(DomicileDisplayRegionsTest, CoverageIsEachMonitorsPartAndTheRest) {
  // A layer spanning the 1.5x monitor and the 2x one, drawn 1:1.
  const std::vector<DomicileCoveragePiece> pieces =
      DomicileCoverage(Desk(), gfx::Transform(), gfx::Rect(2000, 0, 2000, 100));
  ASSERT_EQ(pieces.size(), 2u);
  EXPECT_EQ(pieces[0].rect, gfx::Rect(2000, 0, 880, 100));
  EXPECT_EQ(pieces[0].ratio, 0.75f);
  EXPECT_EQ(pieces[1].rect, gfx::Rect(2880, 0, 1120, 100));
  EXPECT_EQ(pieces[1].ratio, 1.f);
}

TEST(DomicileDisplayRegionsTest, CoverageOfOverlappingMonitorsGoesToTheFirst) {
  const DomicileDisplayRegions mirrored = {
      {gfx::Rect(0, 0, 100, 100), 0.5f},
      {gfx::Rect(50, 0, 100, 100), 0.75f},
  };
  const std::vector<DomicileCoveragePiece> pieces =
      DomicileCoverage(mirrored, gfx::Transform(), gfx::Rect(0, 0, 150, 100));
  ASSERT_EQ(pieces.size(), 2u);
  EXPECT_EQ(pieces[0].rect, gfx::Rect(0, 0, 100, 100));
  EXPECT_EQ(pieces[0].ratio, 0.5f);
  EXPECT_EQ(pieces[1].rect, gfx::Rect(100, 0, 50, 100));
  EXPECT_EQ(pieces[1].ratio, 0.75f);
}

TEST(DomicileDisplayRegionsTest, CoverageOfATurnedLayerIsAllOfItAtOne) {
  gfx::Transform turned;
  turned.Rotate(30);
  const std::vector<DomicileCoveragePiece> pieces =
      DomicileCoverage(Desk(), turned, gfx::Rect(0, 0, 10, 10));
  ASSERT_EQ(pieces.size(), 1u);
  EXPECT_EQ(pieces[0].rect, gfx::Rect(0, 0, 10, 10));
  EXPECT_EQ(pieces[0].ratio, 1.f);
}

TEST(DomicileDisplayRegionsTest, ALayerInThePageKeepsAndDrawsItsTilings) {
  const DomicileLayer layer = {.to_page_is_scale_or_translation = true,
                               .draws_into_page = true,
                               .is_directly_composited_image = false};
  EXPECT_TRUE(DomicileKeepsDisplayTilings(layer));
  EXPECT_TRUE(DomicileDrawsFromDisplayTilings(layer));
}

TEST(DomicileDisplayRegionsTest, ALayerInASurfaceOfItsOwnKeepsItsTilings) {
  // A window being dragged, at an opacity: a surface of its own until it is
  // dropped. Given up here, its tilings were rebuilt empty on the drop, and
  // the monitor showed the page's tiles, shrunk, until they were rastered.
  const DomicileLayer layer = {.to_page_is_scale_or_translation = true,
                               .draws_into_page = false,
                               .is_directly_composited_image = false};
  EXPECT_TRUE(DomicileKeepsDisplayTilings(layer));
  EXPECT_FALSE(DomicileDrawsFromDisplayTilings(layer));
}

TEST(DomicileDisplayRegionsTest, ATurnedLayerHasNoTilings) {
  const DomicileLayer layer = {.to_page_is_scale_or_translation = false,
                               .draws_into_page = false,
                               .is_directly_composited_image = false};
  EXPECT_FALSE(DomicileKeepsDisplayTilings(layer));
  EXPECT_FALSE(DomicileDrawsFromDisplayTilings(layer));
}

TEST(DomicileDisplayRegionsTest, ADirectlyCompositedImageHasNoTilings) {
  const DomicileLayer layer = {.to_page_is_scale_or_translation = true,
                               .draws_into_page = true,
                               .is_directly_composited_image = true};
  EXPECT_FALSE(DomicileKeepsDisplayTilings(layer));
  EXPECT_FALSE(DomicileDrawsFromDisplayTilings(layer));
}

TEST(DomicileDisplayRegionsTest, CoverageWithNoRegionsIsAllOfItAtOne) {
  const std::vector<DomicileCoveragePiece> pieces =
      DomicileCoverage({}, gfx::Transform(), gfx::Rect(0, 0, 10, 10));
  ASSERT_EQ(pieces.size(), 1u);
  EXPECT_EQ(pieces[0].rect, gfx::Rect(0, 0, 10, 10));
  EXPECT_EQ(pieces[0].ratio, 1.f);
}

// `home-office-right-two`, as the browser tells the desk page: a 1.5 laptop
// under the left edge of two 1.2 4K monitors turned on their sides, in a
// 5520x3200 desk.
std::vector<DomicileDisplay> HomeOfficeRightTwo() {
  return {
      {gfx::Rect(0, 1920, 1920, 1280), 1.5f},
      {gfx::Rect(1920, 0, 1800, 3200), 1.2f},
      {gfx::Rect(3720, 0, 1800, 3200), 1.2f},
  };
}

constexpr size_t kNoCeiling = std::numeric_limits<size_t>::max();

TEST(DomicileDisplayRegionsTest, TheDeskHasTileMemoryForEveryMonitor) {
  // The page at 1.5 is 8280x4800, 39744000 pixels. Each 1.2 monitor's tiling
  // is its own 2160x3840, 8294400 pixels. 56332800 pixels at 4 bytes, 8 times.
  EXPECT_EQ(DomicileTileBytesFor(HomeOfficeRightTwo(),
                                 gfx::Rect(0, 0, 5520, 3200), 1.5f, kNoCeiling),
            1802649600u);
}

TEST(DomicileDisplayRegionsTest, AWidgetHasTileMemoryForWhereItIs) {
  // A <webview> on the center monitor: 600x450 at 1.5, and as much again at
  // 0.8 squared for the monitor's tiling of it. 442800 pixels, 4 bytes, 8 times.
  EXPECT_EQ(
      DomicileTileBytesFor(HomeOfficeRightTwo(), gfx::Rect(2000, 100, 400, 300),
                           1.5f, kNoCeiling),
      14169600u);
}

TEST(DomicileDisplayRegionsTest, TheDesksTileMemoryIsAtMostTheCeiling) {
  EXPECT_EQ(DomicileTileBytesFor(HomeOfficeRightTwo(),
                                 gfx::Rect(0, 0, 5520, 3200), 1.5f, 1000),
            1000u);
}

TEST(DomicileDisplayRegionsTest, AWidgetOnNoMonitorAsksForNoTileMemory) {
  // An ordinary page: its policy stays upstream's.
  EXPECT_EQ(DomicileTileBytesFor({}, gfx::Rect(0, 0, 1920, 1080), 2.f,
                                 kNoCeiling),
            0u);
}

}  // namespace
}  // namespace cc
