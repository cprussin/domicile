// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/display_capture_target.h"

#include <vector>

#include "components/viz/common/surfaces/frame_sink_id.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {
namespace {

constexpr viz::FrameSinkId kLeftRoot(0u, 3u);
constexpr viz::FrameSinkId kRightRoot(0u, 4u);

// Two monitors side by side, in CRTC pixels.
std::vector<display::Display> Desk() {
  return {display::Display(11, gfx::Rect(0, 0, 2560, 1440)),
          display::Display(22, gfx::Rect(2560, 0, 1920, 1080))};
}

TEST(DisplayCaptureTargetTest, ADisplayIsTheWindowScannedOutOnIt) {
  const std::vector<CaptureRoot> windows = {
      {.bounds_in_pixels = gfx::Rect(2560, 0, 1920, 1080),
       .frame_sink_id = kRightRoot},
      {.bounds_in_pixels = gfx::Rect(0, 0, 2560, 1440),
       .frame_sink_id = kLeftRoot}};

  EXPECT_EQ(CaptureTargetFor(11, Desk(), windows), kLeftRoot);
  EXPECT_EQ(CaptureTargetFor(22, Desk(), windows), kRightRoot);
}

TEST(DisplayCaptureTargetTest, ADisplayWhoseWindowIsStillOpeningHasNone) {
  const std::vector<CaptureRoot> windows = {
      {.bounds_in_pixels = gfx::Rect(0, 0, 2560, 1440),
       .frame_sink_id = kLeftRoot}};

  EXPECT_FALSE(CaptureTargetFor(22, Desk(), windows).has_value());
}

TEST(DisplayCaptureTargetTest, AnUnknownDisplayHasNone) {
  const std::vector<CaptureRoot> windows = {
      {.bounds_in_pixels = gfx::Rect(0, 0, 2560, 1440),
       .frame_sink_id = kLeftRoot}};

  EXPECT_FALSE(CaptureTargetFor(33, Desk(), windows).has_value());
}

TEST(DisplayCaptureTargetTest, ZeroIsTheFirstWindowOfABrowserWithNoDisplays) {
  const std::vector<CaptureRoot> windows = {
      {.bounds_in_pixels = gfx::Rect(0, 0, 800, 600),
       .frame_sink_id = kLeftRoot},
      {.bounds_in_pixels = gfx::Rect(0, 0, 400, 300),
       .frame_sink_id = kRightRoot}};

  EXPECT_EQ(CaptureTargetFor(0, {}, windows), kLeftRoot);
  EXPECT_FALSE(CaptureTargetFor(0, {}, {}).has_value());
}

}  // namespace
}  // namespace domicile
