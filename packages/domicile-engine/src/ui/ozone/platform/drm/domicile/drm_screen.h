// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SCREEN_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SCREEN_H_

#include <stddef.h>

#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/time/time.h"
#include "ui/display/display.h"
#include "ui/display/display_list.h"
#include "ui/display/types/display_snapshot.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/size.h"
#include "ui/ozone/public/ozone_platform.h"
#include "ui/ozone/public/platform_screen.h"

namespace ui {

class DrmWindowHostManager;

// The display a screen answers with when DRM has told it about none.
//
// PlatformScreen's contract is that a screen always has a primary display --
// HeadlessScreen CHECKs its primary iterator and aura dereferences the result
// -- so "no displays" is not an answer this interface can give. A tty with
// nothing plugged into it is an ordinary state, not an error: it is what every
// connector on the machine this was written on reports.
inline constexpr gfx::Size kDisplaylessBounds{1024, 768};

// One snapshot, as the display list wants it.
//
// This is the whole of what Domicile takes from `ui/display/manager`, whose
// DisplayChangeObserver spends 478 lines turning snapshots into
// ManagedDisplayInfo -- ChromeOS product surface that nothing here reads. The
// SIZE comes from the snapshot's native mode, which is the mode the modeset
// driver will configure the CRTC at, so the two cannot disagree.
//
// The CORNER is passed in rather than read off the snapshot, because it is not
// always the snapshot's: a matched output profile places the monitors and the
// card's own stacking is not that arrangement. `DisplaysFromSnapshots` is
// where the two are told apart.
display::Display DisplayFromSnapshot(const display::DisplaySnapshot& snapshot,
                                     const gfx::Point& origin);

// What to call this monitor: "<MAKE> <MODEL> <SERIAL>", the identity kanshi
// and sway match an output profile on.
//
// THE WHOLE REASON THIS EXISTS IS THAT AN ID IS NOT A NAME.
// `display_id()` is derived from the EDID and is perfectly good identity -- it
// is stable across a hotplug and it does tell three identical monitors apart.
// What it cannot do is say WHICH ONE: it is an int64 nobody can look at a desk
// and predict, so a person writing "put the left-hand monitor here" has to
// read one off a log first and write down a number that means nothing. This is
// the same identity, spelled the way the panel is labeled.
//
// Each of the three parts can be missing and the name is what is left --
// `ManufacturerIdToString` gives "" for a product code nobody set, a panel
// need not carry a product-name descriptor, and a serial is often absent. A
// monitor that reports none of the three gets an empty string, and
// `DisplayFromSnapshot` leaves the label unset rather than naming everything
// on the desk the same nothing.
//
// The make is the three-letter PNP id -- "DEL", not "Dell Inc." -- because
// that is what the EDID holds. The full vendor name is a lookup table
// (hwdata's pnp.ids) that libdisplay-info carries and Chromium does not, so a
// name from here is one word off what sway prints for the same monitor.
std::string DisplayNameFromSnapshot(const display::DisplaySnapshot& snapshot);

// The snapshot's physical size, in millimeters.
//
// Named rather than inlined because it is the number `wl_output` wants, and it
// is where the density `DisplayFromSnapshot` sets on the display comes from --
// display::Display has no millimeters of its own, which is the whole reason
// that conversion is there. See `drm_screen.cc`.
gfx::Size DisplayPhysicalSizeMm(const display::DisplaySnapshot& snapshot);

// Every snapshot, or the displayless fallback above when there are none.
//
// EACH TURNED AND SCALED THE WAY THE LAYOUT SAYS, which is how a shell gets
// out of knowing a monitor is on its side. The rotation and the scale are
// what views turns this display's window by and what every page on it lays
// out at, so the page's CSS pixels are the compositor's logical ones, upright.
// A display the layout does not name is neither.
//
// THE BOUNDS STAY THE CRTC'S, in pixels, scale or no scale -- not the DIP
// rectangle a display's bounds usually are. Everything on this platform reads
// them that way: a window is bound to a CRTC on an exact match with them, a
// fullscreen window is sized from them, and the compositor places its
// connectors in them. What the rotation and the scale change is what is drawn
// INSIDE the window, which is the only place either belongs.
//
// `layout` IS THE COMPOSITOR'S, and it reaches the display list as well as the
// modeset because a dark connector is still a connector the browser has to
// place somewhere. A display the layout names takes the corner the layout gave
// it, lit or not: leaving a dark one where the CARD stacked it is how two
// displays end up claiming one rectangle, and the first of those wins every
// lookup `GetDisplayMatching` makes -- including the one that sizes a
// fullscreen window, which would then be a window on a screen that is off.
std::vector<display::Display> DisplaysFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
    const std::vector<DomicileDisplayLayout>& layout);

// Which of `snapshots` the display list calls primary: the first one the
// layout lights, or the first there is where it says nothing.
//
// THIS IS THE DIFFERENCE BETWEEN A DESKTOP AND A BLACK SCREEN. A views browser
// going fullscreen is sized from the display it is on, and the window it
// starts at -- 1050x1900 at (10, 10) -- is on whichever display holds that
// corner. A profile that turns the laptop panel off is the ordinary case on a
// full desk, and a primary that is dark is a browser drawing correctly onto a
// screen nobody can see, with every log line saying the modeset succeeded.
//
// A free function beside `DisplaysFromSnapshots` so it has a test of its own:
// "which display is primary" and "where is each display" are two answers, and
// a suite asserting only the second would not notice the first go wrong.
size_t PrimaryIndexForLayout(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
    const std::vector<DomicileDisplayLayout>& layout);

// `PlatformScreen` over the displays DRM reports.
//
// Modeled on HeadlessScreen rather than WaylandScreen: headless has no
// window-system output protocol either, so it builds its display list from
// nothing, and DRM is that shape with real snapshots in place of the fiction.
class DrmScreen : public PlatformScreen {
 public:
  explicit DrmScreen(DrmWindowHostManager* window_manager);

  DrmScreen(const DrmScreen&) = delete;
  DrmScreen& operator=(const DrmScreen&) = delete;

  ~DrmScreen() override;

  // Replaces the whole display list, primary first. Called on startup and
  // again on every hotplug, because DisplayList notifies its observers from
  // Add/Update/RemoveDisplay -- which is why hotplug needs no observer code of
  // its own here.
  void OnDisplaysChanged(
      const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
      const std::vector<DomicileDisplayLayout>& layout);

  // PlatformScreen:
  const std::vector<display::Display>& GetAllDisplays() const override;
  display::Display GetPrimaryDisplay() const override;
  display::Display GetDisplayForAcceleratedWidget(
      gfx::AcceleratedWidget widget) const override;
  gfx::Point GetCursorScreenPoint() const override;
  gfx::AcceleratedWidget GetAcceleratedWidgetAtScreenPoint(
      const gfx::Point& point_in_dip) const override;
  display::Display GetDisplayNearestPoint(
      const gfx::Point& point_in_dip) const override;
  display::Display GetDisplayMatching(
      const gfx::Rect& match_rect) const override;
  bool IsScreenSaverActive() const override;
  base::TimeDelta CalculateIdleTime() const override;
  void AddObserver(display::DisplayObserver* observer) override;
  void RemoveObserver(display::DisplayObserver* observer) override;

 private:
  const raw_ptr<DrmWindowHostManager> window_manager_;
  display::DisplayList display_list_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SCREEN_H_
