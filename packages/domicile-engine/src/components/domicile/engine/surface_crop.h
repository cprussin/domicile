// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_SURFACE_CROP_H_
#define COMPONENTS_DOMICILE_ENGINE_SURFACE_CROP_H_

#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {

// Converts `crop` to normalized TextureDrawQuad UVs within `buffer`. An empty
// crop or buffer yields the whole buffer.
//
// Implements xdg_surface.set_window_geometry: a client that draws its own
// shadow commits a buffer larger than its window, and only the window fills
// the <app> element.
gfx::RectF CropToUv(const gfx::Rect& crop, const gfx::Size& buffer);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_SURFACE_CROP_H_
