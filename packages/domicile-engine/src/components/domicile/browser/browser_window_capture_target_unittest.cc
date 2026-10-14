// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_window_capture_target.h"

#include <optional>
#include <string>

#include "base/functional/bind.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

constexpr viz::FrameSinkId kGuest(5u, 1u);

TEST(BrowserWindowCaptureTargetTest, APageIsCapturedAtItsSizeInPixels) {
  // A fractional scale rounds up, so the capture never cuts off a row.
  EXPECT_EQ(
      BrowserWindowCaptureTargetOf(kGuest, gfx::Size(801, 600), 1.5f),
      (BrowserWindowCaptureTarget{.frame_sink_id = kGuest,
                                  .size_in_pixels = gfx::Size(1202, 900)}));
}

TEST(BrowserWindowCaptureTargetTest, AnEmptyPageHasNoTarget) {
  EXPECT_EQ(BrowserWindowCaptureTargetOf(kGuest, gfx::Size(0, 600), 2.0f),
            std::nullopt);
}

TEST(BrowserWindowCaptureTargetTest, WindowsAreFoundThroughTheFinderOnceSet) {
  EXPECT_EQ(FindBrowserWindowCaptureTarget("1"), std::nullopt);

  SetBrowserWindowCaptureTargetFinder(
      base::BindRepeating([](const std::string& window_id)
                              -> std::optional<BrowserWindowCaptureTarget> {
        return window_id == "1"
                   ? BrowserWindowCaptureTargetOf(kGuest, gfx::Size(10, 10), 1)
                   : std::nullopt;
      }));

  EXPECT_EQ(FindBrowserWindowCaptureTarget("1"),
            BrowserWindowCaptureTargetOf(kGuest, gfx::Size(10, 10), 1));
  EXPECT_EQ(FindBrowserWindowCaptureTarget("2"), std::nullopt);
  SetBrowserWindowCaptureTargetFinder(BrowserWindowCaptureTargetFinder());
}

}  // namespace
}  // namespace domicile
