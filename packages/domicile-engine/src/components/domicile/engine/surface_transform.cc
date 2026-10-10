// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/surface_transform.h"

#include "base/notreached.h"

namespace domicile {

namespace {

// Maps a point in the buffer's orientation to the box, as
// gfx::Transform::Affine spells it: x' = a*x + c*y + e, y' = b*x + d*y + f.
gfx::Transform ToBox(BufferTransform transform, double width, double height) {
  switch (transform) {
    case BufferTransform::kNormal:
      return gfx::Transform();
    case BufferTransform::kRotate90:
      return gfx::Transform::Affine(0, -1, 1, 0, 0, height);
    case BufferTransform::kRotate180:
      return gfx::Transform::Affine(-1, 0, 0, -1, width, height);
    case BufferTransform::kRotate270:
      return gfx::Transform::Affine(0, 1, -1, 0, width, 0);
    case BufferTransform::kFlipped:
      return gfx::Transform::Affine(-1, 0, 0, 1, width, 0);
    case BufferTransform::kFlipped90:
      return gfx::Transform::Affine(0, -1, -1, 0, width, height);
    case BufferTransform::kFlipped180:
      return gfx::Transform::Affine(1, 0, 0, -1, 0, height);
    case BufferTransform::kFlipped270:
      return gfx::Transform::Affine(0, 1, 1, 0, 0, 0);
  }
  NOTREACHED();
}

bool IsQuarterTurn(BufferTransform transform) {
  switch (transform) {
    case BufferTransform::kRotate90:
    case BufferTransform::kRotate270:
    case BufferTransform::kFlipped90:
    case BufferTransform::kFlipped270:
      return true;
    case BufferTransform::kNormal:
    case BufferTransform::kRotate180:
    case BufferTransform::kFlipped:
    case BufferTransform::kFlipped180:
      return false;
  }
  NOTREACHED();
}

}  // namespace

BufferQuad QuadForBuffer(BufferTransform transform, const gfx::Size& box) {
  return {
      .rect = gfx::Rect(IsQuarterTurn(transform) ? gfx::TransposeSize(box)
                                                 : box),
      .to_box = ToBox(transform, box.width(), box.height()),
  };
}

}  // namespace domicile
