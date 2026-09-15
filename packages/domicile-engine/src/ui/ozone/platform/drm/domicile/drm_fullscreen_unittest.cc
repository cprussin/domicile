// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_fullscreen.h"

#include <optional>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/rect.h"

namespace ui {
namespace {

// Chromium's default window on a 2880x1920 panel: `kWindowMaxDefaultWidth`
// wide, the work area inset by `kWindowTilePixels`, at that same inset. The
// rectangle a desktop on a tty comes up with, and the reason it draws nothing.
constexpr gfx::Rect kDefaultWindow{10, 10, 1050, 1900};
constexpr gfx::Rect kPanel{0, 0, 2880, 1920};

TEST(DrmFullscreenTest, GoingFullscreenTakesTheWholeDisplay) {
  // Exactly the display, not merely as large as it: `FindWindowAt` compares
  // whole rectangles, so an origin of (10, 10) is as unbound as a wrong size.
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
  // Not an invented default and not an empty rect: a window asked to leave a
  // state it was never in should not move, and a zero rect here would unbind
  // it from its controller and blank the screen.
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
