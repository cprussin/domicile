// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_crop.h"

namespace domicile {

gfx::RectF CropToUv(const gfx::Rect& crop, const gfx::Size& buffer) {
  if (crop.IsEmpty() || buffer.IsEmpty()) {
    return gfx::RectF(0.f, 0.f, 1.f, 1.f);
  }
  const float width = buffer.width();
  const float height = buffer.height();
  return gfx::RectF(crop.x() / width, crop.y() / height, crop.width() / width,
                    crop.height() / height);
}

}  // namespace domicile
