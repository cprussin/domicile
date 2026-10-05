// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CONTENT_PUBLIC_BROWSER_DOMICILE_DESK_H_
#define CONTENT_PUBLIC_BROWSER_DOMICILE_DESK_H_

#include <stdint.h>

#include <memory>
#include <optional>
#include <vector>

#include "base/callback_list.h"
#include "base/functional/callback_forward.h"
#include "content/common/content_export.h"
#include "ui/display/screen_infos.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"

namespace ui {
class Layer;
}  // namespace ui

namespace content {

class WebContents;

// One lit display, where the compositor's profile put it on the desk.
//
// See docs/architecture/ONE-PAGE-FOR-THE-DESK.md: with --domicile-one-page the
// shell is one page over the whole desk, and //chrome/browser/domicile lays
// that page out from these.
struct DomicileDeskDisplay {
  int64_t id = 0;
  // In the desk's logical pixels.
  gfx::Rect desk;
  float scale = 1.0f;

  friend bool operator==(const DomicileDeskDisplay&,
                         const DomicileDeskDisplay&) = default;
};

// The lit displays, as the compositor last stated its layout. Empty until it
// has, and on every platform but DRM.
CONTENT_EXPORT std::vector<DomicileDeskDisplay> GetDomicileDesk();

// Runs `changed` every time the compositor states a layout that differs from
// the last. On the UI thread.
CONTENT_EXPORT base::CallbackListSubscription AddDomicileDeskObserver(
    base::RepeatingClosure changed);

// What every page in `contents` is told about its screen, in place of the
// display its window is on; `std::nullopt` stops. The page spanning the desk
// is on no one display, and is laid out at the desk's scale, not its host's.
CONTENT_EXPORT void SetDomicileDeskScreenInfos(
    WebContents* contents,
    std::optional<display::ScreenInfos> infos);

// Where a window lays out its contents instead of its client area: the page a
// desk is, which is bigger than the window and offset so the window shows its
// own display's part. In the window's DIPs; `std::nullopt` stops. Read by
// chrome's browser view layout, which is not the caller's to reach.
CONTENT_EXPORT void SetDomicileDeskPageBounds(gfx::NativeWindow window,
                                              std::optional<gfx::Rect> bounds);
CONTENT_EXPORT std::optional<gfx::Rect> GetDomicileDeskPageBounds(
    gfx::NativeWindow window);

// The page a desk is, shown in another window's layers: a mirror of the
// page's surface layer, which viz draws there at that window's scale. The
// page's frame sink stays a child of the host's compositor alone, so the page
// ticks at the host display's BeginFrames.
class CONTENT_EXPORT DomicileDeskMirror {
 public:
  virtual ~DomicileDeskMirror() = default;

  // Owned by this; the caller parents and places it.
  virtual ui::Layer* layer() = 0;

  // Whether this still mirrors `page`'s current view. A new renderer is a new
  // view, and the old one's mirror shows nothing.
  virtual bool Mirrors(WebContents* page) const = 0;
};

// `nullptr` for a page with no view yet.
CONTENT_EXPORT std::unique_ptr<DomicileDeskMirror> MirrorDomicileDeskPage(
    WebContents* page);

}  // namespace content

#endif  // CONTENT_PUBLIC_BROWSER_DOMICILE_DESK_H_
