// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_FULLSCREEN_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_FULLSCREEN_H_

#include <optional>

#include "ui/gfx/geometry/rect.h"

namespace ui {

// Which rectangle a window takes when its fullscreen state changes.
//
// ON A TTY THIS DECIDES WHETHER ANYTHING IS DRAWN AT ALL.
// `ScreenManager::UpdateControllerToWindowMapping` binds a window to a display
// controller through `FindWindowAt`, which compares the window's rectangle to
// `gfx::Rect(controller->origin(), controller->GetModeSize())` for EXACT
// equality. A window that is not precisely the CRTC's rect is a window with no
// controller, and every frame it submits is dropped before it reaches the
// kernel -- a black screen with nothing wrong in any log.
//
// A free function so that it has a test, for the reason `DrmModeset`'s own
// arithmetic is one: everything around it is a platform singleton the window
// host is handed rather than owns, and wiring is what the browser exercises.
//
// `restored` is what the window was before it went fullscreen, if it has been.
// A window asked to leave fullscreen having never entered it keeps what it
// has, which is the same answer `GetRestoredBoundsInDIP` already gives.
gfx::Rect BoundsForFullscreenChange(bool fullscreen,
                                    const gfx::Rect& current,
                                    const std::optional<gfx::Rect>& restored,
                                    const gfx::Rect& display);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_FULLSCREEN_H_
