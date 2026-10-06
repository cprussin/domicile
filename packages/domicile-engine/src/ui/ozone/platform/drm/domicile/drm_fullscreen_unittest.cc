// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_fullscreen.h"

#include <optional>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/rect.h"

namespace ui {
namespace {

// Chromium's default window bounds on a 2880x1920 panel. A window left at
// these bounds on a tty draws nothing.
constexpr gfx::Rect kDefaultWindow{10, 10, 1050, 1900};
constexpr gfx::Rect kPanel{0, 0, 2880, 1920};

TEST(DrmFullscreenTest, GoingFullscreenTakesTheWholeDisplay) {
  // Exactly the display: `FindWindowAt` compares whole rects, so a wrong
  // origin unbinds the window as much as a wrong size.
  EXPECT_EQ(BoundsForFullscreenChange(/*fullscreen=*/true, kDefaultWindow,
                                      std::nullopt, kPanel),
            kPanel);
}

TEST(DrmFullscreenTest, LeavingFullscreenGoesBackToWhatItWas) {
  EXPECT_EQ(BoundsForFullscreenChange(/*fullscreen=*/false, kPanel,
                                      kDefaultWindow, kPanel),
            kDefaultWindow);
}

TEST(DrmFullscreenTest, AWindowThatWasNeverRestoredKeepsWhatItHas) {
  // The window stays put. An empty rect would unbind it from its controller
  // and blank the screen.
  EXPECT_EQ(BoundsForFullscreenChange(/*fullscreen=*/false, kDefaultWindow,
                                      std::nullopt, kPanel),
            kDefaultWindow);
}

TEST(DrmFullscreenTest, AFullscreenWindowIgnoresWhatItWouldRestoreTo) {
  EXPECT_EQ(BoundsForFullscreenChange(/*fullscreen=*/true, kDefaultWindow,
                                      kDefaultWindow, kPanel),
            kPanel);
}

}  // namespace
}  // namespace ui
