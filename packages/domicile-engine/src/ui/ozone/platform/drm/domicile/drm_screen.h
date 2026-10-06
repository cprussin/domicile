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

class DrmCursor;
class DrmWindowHostManager;

// The size of the fallback display used when DRM reports none.
//
// `PlatformScreen` must always have a primary display: `HeadlessScreen` CHECKs
// for one and aura dereferences it. A tty with nothing plugged in is normal.
inline constexpr gfx::Size kDisplaylessBounds{1024, 768};

// Converts a snapshot to a `display::Display`.
//
// This replaces ChromeOS's `DisplayChangeObserver`. The size is the native
// mode, which is what the modeset driver configures, so the two agree.
// `origin` is passed in because a matched profile can place the monitor
// somewhere other than the snapshot's own origin.
display::Display DisplayFromSnapshot(const display::DisplaySnapshot& snapshot,
                                     const gfx::Point& origin);

// Returns "<MAKE> <MODEL> <SERIAL>", the name kanshi and sway match output
// profiles on.
//
// `display_id()` is stable but is an opaque number, so users could not write
// a profile without reading it from a log. Any missing part is omitted; with
// none, this returns "" and `DisplayFromSnapshot` leaves the label unset.
//
// The make is the EDID's three-letter PNP id ("DEL"). Chromium lacks the PNP
// table for the full vendor name. See docs/DISPLAYS.md#monitor-names.
std::string DisplayNameFromSnapshot(const display::DisplaySnapshot& snapshot);

// Returns the snapshot's physical size, in millimeters.
//
// `wl_output` needs it, and `DisplayFromSnapshot` derives the display's
// density from it because `display::Display` has no physical size. See
// docs/DISPLAYS.md#physical-size-and-refresh.
gfx::Size DisplayPhysicalSizeMm(const display::DisplaySnapshot& snapshot);

// Returns a display per snapshot, or the displayless fallback when there are
// none.
//
// Each display gets the rotation and scale `layout` gives it, so pages lay out
// in the compositor's upright logical pixels and shells need not handle
// rotation. Displays the layout does not name get neither.
//
// Bounds stay in CRTC pixels, not DIPs. This platform binds windows to CRTCs
// on an exact bounds match, sizes fullscreen windows from them, and the
// compositor places connectors in them. Rotation and scale only affect what
// is drawn inside the window.
//
// `layout` applies here as well as to the modeset because the browser must
// still place dark connectors. Origins come from `OriginsForLayout`.
std::vector<display::Display> DisplaysFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
    const std::vector<DomicileDisplayLayout>& layout);

// Returns each snapshot's origin on this process's desktop, in order. Both
// the modeset and the display list use it: windows bind to CRTCs on an exact
// rectangle match, so any disagreement leaves a screen black.
//
// A connector the layout names, lit or not, takes the layout's origin. Others
// are placed in connector order past the right edge of everything the layout
// placed; with no layout, that is every connector. The snapshot's own origin
// is never used: ozone reports (0, 0) for a connector it has not read before,
// and displays sharing a rectangle share a window, leaving a CRTC black.
std::vector<gfx::Point> OriginsForLayout(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
    const std::vector<DomicileDisplayLayout>& layout);

// Returns the index of the primary display: the first one the layout lights,
// or the first one when the layout is empty.
//
// A views browser sizes its fullscreen window from the display holding its
// initial position. A dark primary, such as a closed laptop panel, would draw
// the desktop onto a screen nobody sees.
size_t PrimaryIndexForLayout(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
    const std::vector<DomicileDisplayLayout>& layout);

// `PlatformScreen` over the displays DRM reports.
//
// Modeled on `HeadlessScreen`, which also has no window-system output
// protocol and builds its display list itself.
class DrmScreen : public PlatformScreen {
 public:
  DrmScreen(DrmWindowHostManager* window_manager, DrmCursor* cursor);

  DrmScreen(const DrmScreen&) = delete;
  DrmScreen& operator=(const DrmScreen&) = delete;

  ~DrmScreen() override;

  // Replaces the display list, primary first. Called at startup and on every
  // hotplug. `DisplayList` notifies observers itself.
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
  const raw_ptr<DrmCursor> cursor_;
  display::DisplayList display_list_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SCREEN_H_
