// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// One display as `DrmScreen` hands it over: 1920x1080 on a 597x336mm panel at
// a hair under 60Hz.
//
// The density is spelled as the division that produced it rather than as
// 81.688, because that division is the seam: `drm_screen.cc` does exactly this
// with the snapshot's own millimeters, and what is asserted below is that
// dividing it back out returns the panel. Its own test asserts the same panel
// from the other end.
display::Display Panel() {
  display::Display screen(7, gfx::Rect(0, 0, 1920, 1080));
  screen.set_pixels_per_inch(display::kInchInMm * 1920 / 597,
                             display::kInchInMm * 1080 / 336);
  screen.set_display_frequency(59.997f);
  return screen;
}

TEST(DomicileDisplayListTest, ADisplayIsItsIdAndWhereItIsOnTheDesktop) {
  const std::vector<mojom::DisplayPtr> list = DisplayListFor({Panel()});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->id, 7);
  EXPECT_EQ(list[0]->bounds, gfx::Rect(0, 0, 1920, 1080));
}

// The millimeters the panel reported, recovered from the only field
// display::Display had to carry them in. Exact at this size, and it has to be:
// a wl_output physical size is millimeters and a client divides the mode by it.
TEST(DomicileDisplayListTest, ThePanelsMillimetersComeBackOutOfItsDensity) {
  const std::vector<mojom::DisplayPtr> list = DisplayListFor({Panel()});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->physical_size_mm, gfx::Size(597, 336));
}

// display::Display counts in Hz and wl_output counts in mHz, so the thousand
// is applied once, here, where the list is built -- rather than by whoever
// reads it, which is a compositor in another process that would have to be
// told which unit it was given.
TEST(DomicileDisplayListTest, ARefreshRateCrossesInMillihertz) {
  const std::vector<mojom::DisplayPtr> list = DisplayListFor({Panel()});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->refresh_mhz, 59997);
}

// A display with no density and no rate is a projector, a virtual output, or a
// connector with no readable mode, and every one of those is an ordinary
// reading. Zero is what wl_output states for a screen with no such number, so
// it crosses as zero rather than as a size divided by nothing.
TEST(DomicileDisplayListTest, ADisplayThatReportedNeitherSaysSo) {
  const display::Display unknown(9, gfx::Rect(0, 0, 1280, 800));

  const std::vector<mojom::DisplayPtr> list = DisplayListFor({unknown});

  ASSERT_EQ(list.size(), 1u);
  EXPECT_EQ(list[0]->physical_size_mm, gfx::Size());
  EXPECT_EQ(list[0]->refresh_mhz, 0);
}

}  // namespace
}  // namespace domicile
