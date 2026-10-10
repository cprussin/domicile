// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_SURFACE_TRANSFORM_H_
#define COMPONENTS_DOMICILE_ENGINE_SURFACE_TRANSFORM_H_

#include <cstdint>

#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/geometry/transform.h"

namespace domicile {

// A client's wl_surface.set_buffer_transform, in `wl_output.transform` order.
enum class BufferTransform : uint32_t {
  kNormal = 0,
  kRotate90 = 1,
  kRotate180 = 2,
  kRotate270 = 3,
  kFlipped = 4,
  kFlipped90 = 5,
  kFlipped180 = 6,
  kFlipped270 = 7,
};

// The quad that shows a buffer upright in a box.
struct BufferQuad {
  // The quad, in the buffer's own orientation: the box on its side for a
  // quarter turn.
  gfx::Rect rect;
  // Maps `rect` onto the box, undoing the client's transform.
  gfx::Transform to_box;
};

// The quad for a buffer the client drew with `transform`, shown in a box
// `box` big.
//
// Implements wl_surface.set_buffer_transform: a client may draw its buffer
// turned to match a rotated monitor.
BufferQuad QuadForBuffer(BufferTransform transform, const gfx::Size& box);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_SURFACE_TRANSFORM_H_
