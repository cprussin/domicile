// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SCREEN_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SCREEN_H_

#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/time/time.h"
#include "ui/display/display.h"
#include "ui/display/display_list.h"
#include "ui/display/types/display_snapshot.h"
#include "ui/gfx/geometry/size.h"
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
// bounds come from the snapshot's native mode, which is the mode the modeset
// driver will configure the CRTC at, so the two cannot disagree.
display::Display DisplayFromSnapshot(const display::DisplaySnapshot& snapshot);

// The snapshot's physical size, in millimeters.
//
// Named rather than inlined because it is the number `wl_output` wants, and it
// is where the density `DisplayFromSnapshot` sets on the display comes from --
// display::Display has no millimeters of its own, which is the whole reason
// that conversion is there. See `drm_screen.cc`.
gfx::Size DisplayPhysicalSizeMm(const display::DisplaySnapshot& snapshot);

// Every snapshot, or the displayless fallback above when there are none.
std::vector<display::Display> DisplaysFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots);

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
        snapshots);

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
