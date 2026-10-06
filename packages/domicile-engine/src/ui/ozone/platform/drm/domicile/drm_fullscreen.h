// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_FULLSCREEN_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_FULLSCREEN_H_

#include <optional>

#include "ui/gfx/geometry/rect.h"

namespace ui {

// Returns the bounds a window takes when its fullscreen state changes.
//
// Fullscreen bounds must equal the CRTC's rect exactly: `ScreenManager` binds
// a window to a display controller only on an exact match, and drops an
// unbound window's frames silently (a black screen).
//
// `restored` is the bounds before the window went fullscreen, if it did.
// Without it, leaving fullscreen keeps `current`, as `GetRestoredBoundsInDIP`
// does. A free function so it can be unit tested.
gfx::Rect BoundsForFullscreenChange(bool fullscreen,
                                    const gfx::Rect& current,
                                    const std::optional<gfx::Rect>& restored,
                                    const gfx::Rect& display);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_FULLSCREEN_H_
