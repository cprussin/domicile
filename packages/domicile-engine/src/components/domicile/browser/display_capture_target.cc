// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/display_capture_target.h"

#include <algorithm>

namespace domicile {

std::optional<viz::FrameSinkId> CaptureTargetFor(
    int64_t display_id,
    const std::vector<display::Display>& displays,
    const std::vector<CaptureRoot>& windows) {
  if (display_id == 0) {
    return windows.empty() ? std::nullopt
                           : std::optional(windows.front().frame_sink_id);
  }
  const auto display =
      std::ranges::find(displays, display_id, &display::Display::id);
  if (display == displays.end()) {
    return std::nullopt;
  }
  const auto window = std::ranges::find(windows, display->bounds(),
                                        &CaptureRoot::bounds_in_pixels);
  if (window == windows.end()) {
    return std::nullopt;
  }
  return window->frame_sink_id;
}

}  // namespace domicile
