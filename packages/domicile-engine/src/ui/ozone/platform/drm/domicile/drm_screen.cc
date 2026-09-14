// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_screen.h"

#include "base/check.h"
#include "base/containers/flat_set.h"
#include "ui/display/display_finder.h"
#include "ui/display/types/display_constants.h"
#include "ui/display/types/display_mode.h"
#include "ui/ozone/platform/drm/host/drm_window_host.h"
#include "ui/ozone/platform/drm/host/drm_window_host_manager.h"

namespace ui {

display::Display DisplayFromSnapshot(const display::DisplaySnapshot& snapshot) {
  // A connector with no native mode is connected but unreadable, and a display
  // with empty bounds is one no window can be placed on -- so it gets the same
  // bounds a machine with nothing plugged in gets, rather than nothing.
  const display::DisplayMode* native_mode = snapshot.native_mode();
  const gfx::Size size =
      native_mode ? native_mode->size() : kDisplaylessBounds;
  return display::Display(snapshot.display_id(),
                          gfx::Rect(snapshot.origin(), size));
}

gfx::Size DisplayPhysicalSizeMm(const display::DisplaySnapshot& snapshot) {
  return snapshot.physical_size();
}

std::vector<display::Display> DisplaysFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots) {
  if (snapshots.empty()) {
    return {display::Display(display::kDefaultDisplayId,
                             gfx::Rect(kDisplaylessBounds))};
  }

  std::vector<display::Display> displays;
  displays.reserve(snapshots.size());
  for (const display::DisplaySnapshot* snapshot : snapshots) {
    displays.push_back(DisplayFromSnapshot(*snapshot));
  }
  return displays;
}

DrmScreen::DrmScreen(DrmWindowHostManager* window_manager)
    : window_manager_(window_manager) {}

DrmScreen::~DrmScreen() = default;

void DrmScreen::OnDisplaysChanged(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots) {
  // A hotplug arrives as the whole list rather than as a delta, so what is
  // absent from it has been unplugged. DisplayList notifies its observers from
  // AddOrUpdateDisplay and RemoveDisplay, which is the whole of the hotplug
  // path -- there is no observer code of its own here.
  const std::vector<display::Display> displays =
      DisplaysFromSnapshots(snapshots);

  base::flat_set<int64_t> still_here;
  display::DisplayList::Type type = display::DisplayList::Type::PRIMARY;
  for (const display::Display& display : displays) {
    display_list_.AddOrUpdateDisplay(display, type);
    still_here.insert(display.id());
    type = display::DisplayList::Type::NOT_PRIMARY;
  }

  // Collected before removing rather than removed while iterating: RemoveDisplay
  // erases from the vector this would be walking.
  std::vector<int64_t> unplugged;
  for (const display::Display& display : display_list_.displays()) {
    if (!still_here.contains(display.id())) {
      unplugged.push_back(display.id());
    }
  }
  for (const int64_t id : unplugged) {
    display_list_.RemoveDisplay(id);
  }
}

const std::vector<display::Display>& DrmScreen::GetAllDisplays() const {
  return display_list_.displays();
}

display::Display DrmScreen::GetPrimaryDisplay() const {
  // DisplaysFromSnapshots answers with the displayless display rather than
  // with nothing, so a screen that has been told about its displays -- even
  // that there are none -- always has a primary. One that has not been told
  // yet is a bug in the caller, and this is where it surfaces.
  const auto primary = display_list_.GetPrimaryDisplayIterator();
  CHECK(primary != display_list_.displays().end());
  return *primary;
}

display::Display DrmScreen::GetDisplayForAcceleratedWidget(
    gfx::AcceleratedWidget widget) const {
  // Asked first because GetWindow() is NOTREACHED() on a widget the manager
  // does not hold, and this is handed widgets belonging to other screens.
  if (!window_manager_->HasWindow(widget)) {
    return GetPrimaryDisplay();
  }
  return GetDisplayMatching(
      window_manager_->GetWindow(widget)->GetBoundsInPixels());
}

gfx::Point DrmScreen::GetCursorScreenPoint() const {
  // The cursor position lives in DrmCursor, which the screen is not given.
  // Headless answers the same way, and this becomes real with the input half
  // of docs/architecture/A-DESKTOP-ON-A-TTY.md rather than with the display
  // list.
  return gfx::Point();
}

gfx::AcceleratedWidget DrmScreen::GetAcceleratedWidgetAtScreenPoint(
    const gfx::Point& point_in_dip) const {
  // GetWindowAt() matches on GetBoundsInPixels(), and the point is in DIP. The
  // two are the same number while every display here has a scale factor of 1:
  // nothing sets one, because a snapshot does not carry it. When one does,
  // this is the line that has to scale.
  const DrmWindowHost* window = window_manager_->GetWindowAt(point_in_dip);
  return window ? window->GetAcceleratedWidget() : gfx::kNullAcceleratedWidget;
}

display::Display DrmScreen::GetDisplayNearestPoint(
    const gfx::Point& point_in_dip) const {
  const display::Display* display =
      display::FindDisplayNearestPoint(display_list_.displays(), point_in_dip);
  return display ? *display : GetPrimaryDisplay();
}

display::Display DrmScreen::GetDisplayMatching(
    const gfx::Rect& match_rect) const {
  const display::Display* display = display::FindDisplayWithBiggestIntersection(
      display_list_.displays(), match_rect);
  return display ? *display : GetPrimaryDisplay();
}

bool DrmScreen::IsScreenSaverActive() const {
  // Nothing else is holding this screen. PlatformScreen's own default answers
  // false too, but it answers with NOTIMPLEMENTED_LOG_ONCE() on the way, which
  // is a line in every startup log saying a question was not answered -- and
  // this one is.
  //
  // WaylandScreen has a window-system to ask and still assumes false, because
  // idle_inhibitor says whether the saver is prevented rather than whether it
  // is running. On a tty there is no window-system to ask: Domicile is the
  // compositor, so blanking is the shell's decision and no other client can
  // have taken the screen out from under it.
  return false;
}

base::TimeDelta DrmScreen::CalculateIdleTime() const {
  // Zero is "not idle", and it is the honest answer rather than a stub. Idle
  // is measured from the last input event; input arrives over evdev and
  // belongs to the compositor, which has it and this screen does not. When the
  // shell wants an idle timer it will have one on its own side, and this would
  // report from there rather than from a protocol that does not exist here.
  return base::Seconds(0);
}

void DrmScreen::AddObserver(display::DisplayObserver* observer) {
  display_list_.AddObserver(observer);
}

void DrmScreen::RemoveObserver(display::DisplayObserver* observer) {
  display_list_.RemoveObserver(observer);
}

}  // namespace ui
