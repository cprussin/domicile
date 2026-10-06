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
  // Null makes `CursorLoader` load the cursor from assets. A typed,
  // bitmapless cursor would draw nothing on a CRTC.
  if (type != mojom::CursorType::kNone) {
    return nullptr;
  }

  // `kNone` has no art. `DrmCursor` hides the cursor based on its type, so
  // return the base's typed, bitmapless cursor.
  return BitmapCursorFactory::GetDefaultCursor(type);
}

void DrmCursorFactory::ObserveThemeChanges() {}

}  // namespace ui
