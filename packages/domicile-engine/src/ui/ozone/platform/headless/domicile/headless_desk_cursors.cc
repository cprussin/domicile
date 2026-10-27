// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/headless/domicile/headless_desk_cursors.h"

#include <vector>

#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/gfx/geometry/point.h"
#include "ui/ozone/common/bitmap_cursor.h"

namespace ui {

HeadlessDeskCursorFactory::HeadlessDeskCursorFactory() = default;

HeadlessDeskCursorFactory::~HeadlessDeskCursorFactory() = default;

scoped_refptr<PlatformCursor> HeadlessDeskCursorFactory::GetDefaultCursor(
    mojom::CursorType type) {
  if (type == mojom::CursorType::kNone) {
    return BitmapCursorFactory::GetDefaultCursor(type);
  }
  return nullptr;
}

DeskCursorImage HeadlessDeskCursorImage(PlatformCursor* cursor) {
  if (!cursor) {
    return DeskCursorImageOf(SkBitmap(), gfx::Point(), 1);
  }
  scoped_refptr<BitmapCursor> bitmap_cursor =
      BitmapCursor::FromPlatformCursor(cursor);
  const std::vector<SkBitmap>& bitmaps = bitmap_cursor->bitmaps();
  return DeskCursorImageOf(bitmaps.empty() ? SkBitmap() : bitmaps.front(),
                           bitmap_cursor->hotspot(),
                           bitmap_cursor->cursor_image_scale_factor());
}

}  // namespace ui
