// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_BROWSER_WINDOW_CAPTURE_TARGET_H_
#define COMPONENTS_DOMICILE_BROWSER_BROWSER_WINDOW_CAPTURE_TARGET_H_

#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {

// A browser window's own frame sink and its size in pixels, for a capture of
// the window alone, without the shell's page drawn over it.
struct BrowserWindowCaptureTarget {
  viz::FrameSinkId frame_sink_id;
  gfx::Size size_in_pixels;

  friend bool operator==(const BrowserWindowCaptureTarget&,
                         const BrowserWindowCaptureTarget&) = default;
};

// The target of a page that `frame_sink_id` draws, `size` DIPs big at `scale`
// pixels per DIP. nullopt when it is empty, as a page not yet laid out is.
std::optional<BrowserWindowCaptureTarget> BrowserWindowCaptureTargetOf(
    const viz::FrameSinkId& frame_sink_id,
    const gfx::Size& size,
    float scale);

// Finds browser window `window_id`'s target, or nullopt when it has none.
using BrowserWindowCaptureTargetFinder =
    base::RepeatingCallback<std::optional<BrowserWindowCaptureTarget>(
        const std::string& window_id)>;

// Set once by //chrome, which owns the browser windows (see
// chrome/browser/domicile/domicile_browser_windows.h). The browser's frame
// sink broker in //content asks it. UI thread only.
void SetBrowserWindowCaptureTargetFinder(BrowserWindowCaptureTargetFinder find);

// Browser window `window_id`'s target. nullopt when it has none, or before
// //chrome sets the finder.
std::optional<BrowserWindowCaptureTarget> FindBrowserWindowCaptureTarget(
    const std::string& window_id);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROWSER_WINDOW_CAPTURE_TARGET_H_
