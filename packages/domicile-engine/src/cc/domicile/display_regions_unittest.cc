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

// A 2x page over a 1.5x monitor, a 2x monitor to its right and a 1x monitor
// below that. Rects are in device pixels at 2x.
DomicileDisplayRegions Desk() {
  return {
      {gfx::Rect(0, 0, 2880, 1800), 0.75f},
      {gfx::Rect(5760, 1800, 3840, 2160), 0.5f},
  };
}

TEST(DomicileDisplayRegionsTest, EveryLessDenseMonitorIsARegion) {
  // Desk()'s monitors in DIPs, with the widget at (500, 0).
  const std::vector<DomicileDisplay> displays = {
      {gfx::Rect(500, 0, 1440, 900), 1.5f},
      {gfx::Rect(1940, 0, 1440, 900), 2.f},
      {gfx::Rect(3380, 900, 1920, 1080), 1.f},
  };
  EXPECT_EQ(DomicileDisplayRegionsOf(displays, gfx::Point(500, 0), 2.f),
            Desk());
}

TEST(DomicileDisplayRegionsTest, AWidgetInThePageHasTheRegionsWhereItIs) {
  // A <webview> offset (100, 50) DIPs from the page's origin.
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
  // Inverse of translate (-100, 50) then scale 2 maps (0,0 2880x1800) to
  // (50,-25 1440x900).
  EXPECT_EQ(DomicileRegionInLayer(Desk(), 0.75f, to_target),
            gfx::Rect(50, -25, 1440, 900));
}

TEST(DomicileDisplayRegionsTest, ATurnedLayerHasNoRegion) {
  gfx::Transform turned;
  turned.Rotate(30);
  EXPECT_TRUE(DomicileRegionInLayer(Desk(), 0.75f, turned).IsEmpty());
}

TEST(DomicileDisplayRegionsTest, CoverageIsEachMonitorsPartAndTheRest) {
  // A layer spanning the 1.5x and 2x monitors, with an identity transform.
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
  // E.g. a translucent window mid-drag. Keeping the tilings avoids a flash of
  // shrunk page tiles when it returns to the page on drop.
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

TEST(DomicileDisplayRegionsTest, ADeskOnOneScreenHasUpstreamsTileMemory) {
  // Upstream's reference screen, 2056x1329 at 2, gets 1152 MiB.
  EXPECT_EQ(DomicileTileBytesFor({{gfx::Rect(0, 0, 2056, 1329), 2.f}},
                                 gfx::Rect(0, 0, 2056, 1329), 2.f, kNoCeiling),
            1207959552u);
}

TEST(DomicileDisplayRegionsTest, TheDeskHasTileMemoryForEveryMonitor) {
  // The page at 1.5 is 8280x4800, 39744000 pixels. Each 1.2 monitor's tiling
  // is its own 2160x3840, 8294400 pixels. 56332800 pixels at upstream's
  // 1152 MiB per 2056x1329 at 2.
  EXPECT_EQ(DomicileTileBytesFor(HomeOfficeRightTwo(),
                                 gfx::Rect(0, 0, 5520, 3200), 1.5f, kNoCeiling),
            6225950278u);
}

TEST(DomicileDisplayRegionsTest, AWidgetHasTileMemoryForWhereItIs) {
  // A <webview> on the center monitor: 600x450 at 1.5, and as much again at
  // 0.8 squared for the monitor's tiling of it: 442800 pixels.
  EXPECT_EQ(
      DomicileTileBytesFor(HomeOfficeRightTwo(), gfx::Rect(2000, 100, 400, 300),
                           1.5f, kNoCeiling),
      48938642u);
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

TEST(DomicileDisplayRegionsTest, TheDesksTilesAreSizedForItsLargestMonitor) {
  // A 1.2 monitor, 1800x3200 at 1.5, not the 8280x4800 desk.
  EXPECT_EQ(DomicileTileViewportFor(HomeOfficeRightTwo(),
                                    gfx::Rect(0, 0, 5520, 3200), 1.5f),
            gfx::Size(2700, 4800));
}

TEST(DomicileDisplayRegionsTest, AWidgetOnOneMonitorSizesTilesForItself) {
  // A <webview> on the center monitor, 400x300 at 1.5.
  EXPECT_EQ(DomicileTileViewportFor(HomeOfficeRightTwo(),
                                    gfx::Rect(2000, 100, 400, 300), 1.5f),
            gfx::Size(600, 450));
}

TEST(DomicileDisplayRegionsTest, AWidgetOnNoMonitorHasNoTileViewport) {
  // An ordinary page: cc sizes its tiles from its viewport, as upstream does.
  EXPECT_TRUE(
      DomicileTileViewportFor({}, gfx::Rect(0, 0, 1920, 1080), 2.f).IsEmpty());
}

TEST(DomicileDisplayRegionsTest, AMonitorsTileOutOfMemoryIsNotDrawn) {
  EXPECT_FALSE(DomicileDrawsTile(/*display_ratio=*/0.8f, /*out_of_memory=*/true));
}

TEST(DomicileDisplayRegionsTest, AMonitorsRasteredTileAndThePagesAreDrawn) {
  EXPECT_TRUE(DomicileDrawsTile(/*display_ratio=*/0.8f, /*out_of_memory=*/false));
  // The page's own: nothing finer to fall back to, so drawn as upstream does.
  EXPECT_TRUE(DomicileDrawsTile(/*display_ratio=*/0.f, /*out_of_memory=*/true));
}

}  // namespace
}  // namespace cc
