// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DISPLAY_CAPTURE_TARGET_H_
#define COMPONENTS_DOMICILE_BROWSER_DISPLAY_CAPTURE_TARGET_H_

#include <stdint.h>

#include <optional>
#include <vector>

#include "components/viz/common/surfaces/frame_sink_id.h"
#include "ui/display/display.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {

// One browser window's root frame sink and where it is, in pixels.
struct CaptureRoot {
  gfx::Rect bounds_in_pixels;
  viz::FrameSinkId frame_sink_id;
};

// The root frame sink that shows `display_id`, from `windows` in creation
// order.
//
// - A display id names the window whose rectangle is the display's, the same
//   exact match `ScreenManager::FindWindowAt` uses to scan a window out. DRM
//   display bounds are CRTC pixels.
// - Zero names the first window, for a nested or headless browser, which
//   reports no displays to the producer. That window is the shell's.
//
// nullopt when no window shows it, such as while a new monitor's window opens.
std::optional<viz::FrameSinkId> CaptureTargetFor(
    int64_t display_id,
    const std::vector<display::Display>& displays,
    const std::vector<CaptureRoot>& windows);

// The display each of `windows` shows, in their order, by CaptureTargetFor's
// match: a display's id for the window whose rectangle is the display's, and
// zero for the first window of a browser with no displays. nullopt for a
// window that shows none, such as one still opening. The night light's color
// matrix follows a display to whichever window shows it.
std::vector<std::optional<int64_t>> DisplaysShownBy(
    const std::vector<display::Display>& displays,
    const std::vector<CaptureRoot>& windows);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DISPLAY_CAPTURE_TARGET_H_
