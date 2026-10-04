// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CURSOR_FACTORY_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CURSOR_FACTORY_H_

#include "base/memory/scoped_refptr.h"
#include "ui/base/cursor/cursor_factory.h"
#include "ui/base/cursor/mojom/cursor_type.mojom-shared.h"
#include "ui/ozone/common/bitmap_cursor_factory.h"

namespace ui {

class PlatformCursor;

// Cursor factory for a views browser on a tty. Returns null for every type
// but `kNone`, so `wm::CursorLoader` loads the cursor art from assets.
//
// `wm::CursorLoader` uses any non-null platform cursor and loads assets only
// on null. `BitmapCursorFactory` returns a typed cursor with no bitmap, which
// suits compositors that draw cursors by type. ozone/drm passes that empty
// bitmap to `drmModeSetCursor` with handle 0, which hides the cursor without
// any error. Ash avoids this by building its loader with
// `use_platform_cursors=false`; `views::DesktopNativeCursorManager` uses the
// default, true.
//
// `kNone` must still be answered: the loader always asks the platform for it,
// and `DrmCursor` hides the cursor on that type. Null would show an arrow.
//
// The loader logs one "Failed to load a platform cursor" warning per type.
// That is the expected fallback, not an error.
class DrmCursorFactory : public BitmapCursorFactory {
 public:
  DrmCursorFactory();

  DrmCursorFactory(const DrmCursorFactory&) = delete;
  DrmCursorFactory& operator=(const DrmCursorFactory&) = delete;

  ~DrmCursorFactory() override;

  // Returns null for every type but `kNone`.
  //
  // `GetDefaultCursor(type, scale)` forwards here, so overriding this
  // overload covers both. These cursors don't vary with scale.
  scoped_refptr<PlatformCursor> GetDefaultCursor(
      mojom::CursorType type) override;

  // Unhides the two-argument overload for callers holding a
  // `DrmCursorFactory`; the override above hides it.
  using CursorFactory::GetDefaultCursor;

  // No-op: these cursors have no platform theme. The base's
  // `NOTIMPLEMENTED()` would log an error on every start.
  void ObserveThemeChanges() override;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CURSOR_FACTORY_H_
