// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/display_list.h"

#include <vector>

#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display.h"
#include "ui/display/types/display_constants.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

// A 1920x1080 display on a 597x336mm panel at just under 60Hz, as `DrmScreen`
// builds it.
//
// The density is written as the division `drm_screen.cc` performs, so the
// tests check that inverting it returns the panel's size.
display::Display Panel() {
  display::Display screen(7, gfx::Rect(0, 0, 1920, 1080));
  screen.set_pixels_per_inch(display::kInchInMm * 1920 / 597,
                             display::kInchInMm * 1080 / 336);
  screen.set_display_frequency(59.997f);
  screen.set_label("DEL DELL U3219Q 2ZLS413");
  return screen;
}

TEST(DomicileDisplayListTest, ADisplayIsItsIdAndWhereItIsOnTheDesktop) {
  const std::vector<mojom::DisplayPtr> list = DisplayListFor({Panel()});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->id, 7);
  EXPECT_EQ(list[0]->bounds, gfx::Rect(0, 0, 1920, 1080));
}

// The result must be exact: clients divide the mode by the wl_output size.
TEST(DomicileDisplayListTest, ThePanelsMillimetersComeBackOutOfItsDensity) {
  const std::vector<mojom::DisplayPtr> list = DisplayListFor({Panel()});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->physical_size_mm, gfx::Size(597, 336));
}

// display::Display uses Hz and wl_output uses mHz.
TEST(DomicileDisplayListTest, ARefreshRateCrossesInMillihertz) {
  const std::vector<mojom::DisplayPtr> list = DisplayListFor({Panel()});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->refresh_mhz, 59997);
}

// The name lets a user identify a monitor in a layout; the id is not
// human-readable.
TEST(DomicileDisplayListTest, APanelsNameCrossesAsItWasBuilt) {
  const std::vector<mojom::DisplayPtr> list = DisplayListFor({Panel()});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->name, "DEL DELL U3219Q 2ZLS413");
}

// A monitor with no make, model or serial gets an empty name, not an invented
// one.
TEST(DomicileDisplayListTest, ADisplayWithNoNameCrossesAsEmpty) {
  const display::Display unnamed(9, gfx::Rect(0, 0, 1280, 800));

  const std::vector<mojom::DisplayPtr> list = DisplayListFor({unnamed});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->name, "");
}

// Projectors and virtual outputs report no density or rate. wl_output uses
// zero for unknown.
TEST(DomicileDisplayListTest, ADisplayThatReportedNeitherSaysSo) {
  const display::Display unknown(9, gfx::Rect(0, 0, 1280, 800));

  const std::vector<mojom::DisplayPtr> list = DisplayListFor({unknown});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->physical_size_mm, gfx::Size());
  EXPECT_EQ(list[0]->refresh_mhz, 0);
}

}  // namespace
}  // namespace domicile
