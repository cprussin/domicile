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

// The cursor factory a views browser on a console needs, which is one that
// admits it has no cursors.
//
// A DESKTOP THAT DREW AND TRACKED THE POINTER SHOWED NO POINTER, and the
// reason is a default argument. `wm::CursorLoader` asks the platform's
// factory first and takes any non-null answer as the cursor
// (`ui/wm/core/cursor_loader.cc:194-203`), so the arrow art in
// `ui_lottie_resources` is loaded by `LoadCursorFromAsset` on the next line
// only when the platform answers nothing. `BitmapCursorFactory` never
// answers nothing: it hands back a `BitmapCursor` carrying the TYPE and no
// bitmap, and says so in its own comment --
//
//     // Return a cursor not backed by a bitmap to preserve the type
//     // information. It can still be used to request the compositor to draw
//     // a server-side cursor for the given type.
//
// -- which is exactly right for a platform whose compositor draws the cursor
// from a type, and exactly wrong for one that hands a CRTC a buffer. The
// empty vector reaches `DrmCursor::SendCursorShowLocked`, then
// `HardwareDisplayController::SetCursor` with a bitmap that `drawsNothing()`,
// then `drmModeSetCursor(fd, crtc, 0, 0, 0)` -- handle zero, which is the
// kernel's word for TURN THE CURSOR OFF. It succeeds, so nothing is logged
// anywhere.
//
// ASH HAS THE SAME FACTORY AND NOT THE SAME BUG, and the difference is one
// argument. `ash::NativeCursorManagerAsh` holds
// `wm::CursorLoader cursor_loader_{/*use_platform_cursors=*/false}`, so on
// ChromeOS the factory is never asked and the assets are always loaded.
// `views::DesktopNativeCursorManager` holds a plain `wm::CursorLoader`, and
// that parameter defaults to true. ozone/drm's only upstream consumer is
// ash; this is the fifth thing in this series that ash supplies and a views
// browser does not.
//
// `kNone` IS THE ONE THAT MUST STILL BE ANSWERED. `CursorLoader` routes it
// through the platform whatever `use_platform_cursors_` says, because an
// invisible cursor is made differently on each platform -- and on this one
// `DrmCursor::SendCursorShowLocked` reads `type() == kNone` as "hide", which
// needs the typed, bitmapless object `BitmapCursorFactory` makes. Answering
// nothing for it would send `CursorLoader` to the assets, find no art for an
// invisible cursor, and fall back to the pointer: an arrow drawn exactly
// where something asked for no cursor at all.
//
// This leaves one `LOG(WARNING) << "Failed to load a platform cursor of type
// N"` per type, from `cursor_loader.cc:201`. It is the loader narrating the
// fallback this class exists to reach, and it is not a failure.
class DrmCursorFactory : public BitmapCursorFactory {
 public:
  DrmCursorFactory();

  DrmCursorFactory(const DrmCursorFactory&) = delete;
  DrmCursorFactory& operator=(const DrmCursorFactory&) = delete;

  ~DrmCursorFactory() override;

  // Nothing, for every type but `kNone` -- which is what sends
  // `wm::CursorLoader` to the bitmaps it would otherwise never reach.
  //
  // Only the one-argument overload is replaced. `CursorFactory`'s
  // `GetDefaultCursor(type, scale)` forwards to this one unless a backend
  // overrides it, and the cursors here do not vary with scale.
  scoped_refptr<PlatformCursor> GetDefaultCursor(
      mojom::CursorType type) override;

  // AND THE OTHER OVERLOAD IS PULLED BACK INTO SCOPE. Declaring one
  // `GetDefaultCursor` here hides every other function of that name from
  // anyone holding a `DrmCursorFactory` rather than a `CursorFactory*` --
  // ordinary C++ name hiding, and `BitmapCursorFactory` has the same hole for
  // the same reason. It costs nothing in production, where `wm::CursorLoader`
  // calls `GetDefaultCursor(type, scale)` through a `CursorFactory*` and
  // virtual dispatch lands on the override above by way of the base's
  // forward. It costs a unit test that holds one of these by its own type,
  // which is how it was found.
  using CursorFactory::GetDefaultCursor;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CURSOR_FACTORY_H_
