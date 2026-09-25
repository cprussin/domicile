// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_cursor_factory.h"

#include "ui/base/cursor/mojom/cursor_type.mojom-shared.h"
#include "ui/base/cursor/platform_cursor.h"

namespace ui {

DrmCursorFactory::DrmCursorFactory() = default;

DrmCursorFactory::~DrmCursorFactory() = default;

scoped_refptr<PlatformCursor> DrmCursorFactory::GetDefaultCursor(
    mojom::CursorType type) {
  // THE ANSWER IS NOTHING, AND NOTHING IS THE USEFUL ANSWER. `CursorLoader`
  // reaches `LoadCursorFromAsset` only past a null from here; a typed,
  // bitmapless cursor is a cursor as far as it is concerned, and a CRTC
  // handed one draws nothing.
  if (type != mojom::CursorType::kNone) {
    return nullptr;
  }

  // Except for the invisible one, which is not art and cannot be loaded from
  // any. `DrmCursor` hides on the type, so the object it reads that off has
  // to exist -- and the base class is where the one that carries a type and
  // no bitmap is made.
  return BitmapCursorFactory::GetDefaultCursor(type);
}

}  // namespace ui
