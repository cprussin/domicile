// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DESK_PRESENTERS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DESK_PRESENTERS_H_

#include <stdint.h>

#include <memory>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "ui/gfx/geometry/rect.h"

namespace content {
class WebContents;
}  // namespace content

namespace domicile {

// One display showing the page it does not host.
struct Presented {
  int64_t display = 0;
  // The display's CRTC rectangle: its window must be exactly this, or no
  // controller scans it out (`ScreenManager::FindWindowAt`).
  gfx::Rect pixels;
  // Where the page sits in the display's logical pixels (`PageBoundsOn`).
  gfx::Rect page;
};

// A window on every display but the host's, each showing the host's page.
//
// See docs/architecture/ONE-PAGE-FOR-THE-DESK.md. Each window's root layer
// holds a mirror of the page's surface layer, so it shows the surface the host
// shows, and viz scales the page's frame to this window's own scale
// (`SurfaceAggregator::EmitSurfaceContent`). Input never reaches these
// windows: ozone sends it all to the host.
class DeskPresenters {
 public:
  DeskPresenters();

  DeskPresenters(const DeskPresenters&) = delete;
  DeskPresenters& operator=(const DeskPresenters&) = delete;

  ~DeskPresenters();

  // Shows `page` on each of `displays`, and nothing anywhere else. Windows are
  // kept per display across calls; a mirror is remade when the page's view is
  // another (a new renderer).
  void Present(content::WebContents* page,
               const std::vector<Presented>& displays);

 private:
  struct Presenter;

  std::vector<std::unique_ptr<Presenter>> presenters_;
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_PRESENTERS_H_
