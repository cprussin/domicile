// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_window_capture_target.h"

#include <utility>

#include "base/no_destructor.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

BrowserWindowCaptureTargetFinder& Finder() {
  static base::NoDestructor<BrowserWindowCaptureTargetFinder> finder;
  return *finder;
}

}  // namespace

std::optional<BrowserWindowCaptureTarget> BrowserWindowCaptureTargetOf(
    const viz::FrameSinkId& frame_sink_id,
    const gfx::Size& size,
    float scale) {
  const gfx::Size size_in_pixels = gfx::ScaleToCeiledSize(size, scale);
  if (size_in_pixels.IsEmpty()) {
    return std::nullopt;
  }
  return BrowserWindowCaptureTarget{.frame_sink_id = frame_sink_id,
                                    .size_in_pixels = size_in_pixels};
}

void SetBrowserWindowCaptureTargetFinder(
    BrowserWindowCaptureTargetFinder find) {
  Finder() = std::move(find);
}

std::optional<BrowserWindowCaptureTarget> FindBrowserWindowCaptureTarget(
    const std::string& window_id) {
  return Finder() ? Finder().Run(window_id) : std::nullopt;
}

}  // namespace domicile
