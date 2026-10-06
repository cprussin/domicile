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

// A display that shows the page hosted on another display.
struct Presented {
  int64_t display = 0;
  // The display's CRTC rectangle. The window must match it exactly or no
  // controller scans it out (`ScreenManager::FindWindowAt`).
  gfx::Rect pixels;
  // The page's bounds in the display's logical pixels (`PageBoundsOn`).
  gfx::Rect page;
};

// Windows that show the host's page on every other display.
//
// Each window mirrors the page's surface layer; viz scales the frame to the
// window's scale. Input goes only to the host. See
// docs/architecture/ONE-PAGE-FOR-THE-DESK.md.
class DeskPresenters {
 public:
  DeskPresenters();

  DeskPresenters(const DeskPresenters&) = delete;
  DeskPresenters& operator=(const DeskPresenters&) = delete;

  ~DeskPresenters();

  // Shows `page` on exactly `displays`. Windows persist per display across
  // calls; a mirror is rebuilt when the page's view changes (new renderer).
  void Present(content::WebContents* page,
               const std::vector<Presented>& displays);

 private:
  struct Presenter;

  std::vector<std::unique_ptr<Presenter>> presenters_;
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_PRESENTERS_H_
