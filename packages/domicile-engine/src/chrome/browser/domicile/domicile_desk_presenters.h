// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DESK_PRESENTERS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DESK_PRESENTERS_H_

#include <stdint.h>

#include <memory>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/scoped_multi_source_observation.h"
#include "base/scoped_observation.h"
#include "ui/aura/window.h"
#include "ui/aura/window_observer.h"
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
// window's scale. It also mirrors the page's popups (a <select>'s list, a date
// picker, a tooltip), which the host's window holds as windows of their own.
// Input goes only to the host. See docs/architecture/ONE-PAGE-FOR-THE-DESK.md.
class DeskPresenters : public aura::WindowObserver {
 public:
  DeskPresenters();

  DeskPresenters(const DeskPresenters&) = delete;
  DeskPresenters& operator=(const DeskPresenters&) = delete;

  ~DeskPresenters() override;

  // Shows `page` on exactly `displays`. `page_on_host` is the page's bounds in
  // the host window's logical pixels. Windows persist per display across
  // calls; a mirror is rebuilt when the page's view changes (new renderer).
  void Present(content::WebContents* page,
               const gfx::Rect& page_on_host,
               const std::vector<Presented>& displays);

 private:
  struct Presenter;

  // aura::WindowObserver, on the host's root window and its popups:
  void OnWindowAdded(aura::Window* new_window) override;
  void OnWillRemoveWindow(aura::Window* window) override;
  void OnWindowBoundsChanged(aura::Window* window,
                             const gfx::Rect& old_bounds,
                             const gfx::Rect& new_bounds,
                             ui::PropertyChangeReason reason) override;
  void OnWindowDestroying(aura::Window* window) override;

  // Watches the popups `root` holds, or none if `root` is null.
  void WatchRoot(aura::Window* root);
  void AddPopup(aura::Window* window);
  void RemovePopup(aura::Window* window);
  // Mirrors every popup on every presenter, where the page has it.
  void ShowPopups();

  std::vector<std::unique_ptr<Presenter>> presenters_;
  gfx::Rect page_on_host_;
  std::vector<raw_ptr<aura::Window>> popups_;
  base::ScopedObservation<aura::Window, aura::WindowObserver> root_{this};
  base::ScopedMultiSourceObservation<aura::Window, aura::WindowObserver>
      popup_observations_{this};
};

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_PRESENTERS_H_
