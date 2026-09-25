// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_fullscreen.h"

namespace ui {

gfx::Rect BoundsForFullscreenChange(bool fullscreen,
                                    const gfx::Rect& current,
                                    const std::optional<gfx::Rect>& restored,
                                    const gfx::Rect& display) {
  if (fullscreen) {
    return display;
  }
  return restored.value_or(current);
}

}  // namespace ui
