// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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
