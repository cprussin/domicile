// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_CURSORS_H_
#define UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_CURSORS_H_

#include "base/memory/scoped_refptr.h"
#include "ui/base/cursor/domicile/desk_cursor_image.h"
#include "ui/base/cursor/mojom/cursor_type.mojom-shared.h"
#include "ui/ozone/common/bitmap_cursor_factory.h"

namespace ui {

class PlatformCursor;

// A headless desk's pointers. No window system draws them, so the desk's
// screen casts do, from the image each window last set (see
// `DeskCursorImageSource`, which DRM's `DrmCursor` also feeds). See
// docs/architecture/A-HEADLESS-DESKTOP.md in the Domicile repository.
//
// The base answers each type with a typed cursor and no bitmap, for window
// systems that draw cursors by type. This answers null instead, so
// `wm::CursorLoader` loads Chromium's art and asks for an image cursor. Only
// `kNone` keeps the typed cursor: it hides the pointer.
class HeadlessDeskCursorFactory : public BitmapCursorFactory {
 public:
  HeadlessDeskCursorFactory();

  HeadlessDeskCursorFactory(const HeadlessDeskCursorFactory&) = delete;
  HeadlessDeskCursorFactory& operator=(const HeadlessDeskCursorFactory&) =
      delete;

  ~HeadlessDeskCursorFactory() override;

  // The scaled overload asks this one.
  using CursorFactory::GetDefaultCursor;
  scoped_refptr<PlatformCursor> GetDefaultCursor(
      mojom::CursorType type) override;
};

// The image `cursor` shows: its first frame, or hidden for none or a cursor
// with no bitmap.
DeskCursorImage HeadlessDeskCursorImage(PlatformCursor* cursor);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_CURSORS_H_
