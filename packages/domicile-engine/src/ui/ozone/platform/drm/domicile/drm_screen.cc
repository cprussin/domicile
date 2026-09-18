// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_screen.h"

#include <stddef.h>
#include <stdint.h>

#include <vector>

#include "base/check.h"
#include "base/containers/flat_set.h"
#include "ui/display/display_finder.h"
#include "ui/display/types/display_constants.h"
#include "ui/display/types/display_mode.h"
#include "ui/display/util/edid_parser.h"
#include "ui/ozone/platform/drm/domicile/edid_name.h"
#include "ui/ozone/platform/drm/host/drm_window_host.h"
#include "ui/ozone/platform/drm/host/drm_window_host_manager.h"

namespace ui {

namespace {

// What `layout` says about the connector `id`, or nothing where it is silent.
//
// Duplicated from drm_modeset.cc rather than shared, for the reason
// SnapshotBuilder is duplicated between the two suites: two callers in one
// directory is the wrong trade for a header, and if a third arrives that is
// when it moves.
const DomicileDisplayLayout* WantedFor(
    const std::vector<DomicileDisplayLayout>& layout,
    int64_t id) {
  for (const DomicileDisplayLayout& wanted : layout) {
    if (wanted.id == id) {
      return &wanted;
    }
  }
  return nullptr;
}

}  // namespace

display::Display DisplayFromSnapshot(const display::DisplaySnapshot& snapshot,
                                     const gfx::Point& origin) {
  // A connector with no native mode is connected but unreadable, and a display
  // with empty bounds is one no window can be placed on -- so it gets the same
  // bounds a machine with nothing plugged in gets, rather than nothing.
  const display::DisplayMode* native_mode = snapshot.native_mode();
  const gfx::Size size =
      native_mode ? native_mode->size() : kDisplaylessBounds;
  // Not named `display`: that is the namespace half of this function's own
  // names are in, and a local by that name makes `display::kInchInMm` below
  // fail to compile.
  display::Display screen(snapshot.display_id(), gfx::Rect(origin, size));

  // THE PANEL LEAVES HERE OR IT DOES NOT LEAVE AT ALL. This display::Display is
  // everything the browser process ever learns about a snapshot: the display
  // list a producer is told reaches it as display::Screen::Get()->
  // GetAllDisplays(), which is this list, and the DisplaySnapshot itself is
  // inside //ui/ozone/platform/drm where //content cannot see it. So a number
  // not set below is one that does not exist anywhere the compositor can be
  // told it from.
  //
  // The rate is straightforward: display_frequency() is Hz and is what every
  // other platform's screen reports a mode with (screen_win.cc:296,
  // screen_mac.mm:192, display_manager.cc:2469).
  //
  // THE MILLIMETERS LEAVE AS A DENSITY BECAUSE THERE IS NO FIELD FOR THEM.
  // display::Display carries no physical size -- ManagedDisplayInfo does, and
  // it is //ui/display/manager, 478 lines of ChromeOS product surface this fork
  // deliberately does not port -- and set_pixels_per_inch is the one field
  // whose value IS the panel's size, expressed per axis so both millimeter
  // figures survive. components/domicile/browser/display_list.cc divides it
  // back out by the same kInchInMm, and its test asserts this panel's numbers
  // from the other end.
  //
  // Both are set on the way IN and DisplayList::UpdateDisplay copies neither,
  // so a display the list already has keeps what it was added with. That is
  // safe for exactly the reason the id is: display_id() is derived from the
  // EDID, so an id the list already holds is the same panel -- and a panel's
  // millimeters and its native mode are the two things about it that cannot
  // change while it stays plugged in. What DOES change on a hotplug is the
  // origin, and bounds is copied.
  if (native_mode) {
    screen.set_display_frequency(native_mode->refresh_rate());
  }
  // Zero millimeters is a connector saying it has no physical size -- a
  // projector, a virtual output -- and a density divided out of it would be
  // whatever the mode is over nothing. Left at display::Display's own zero,
  // which is what "nobody said" is there too.
  const gfx::Size millimeters = DisplayPhysicalSizeMm(snapshot);
  if (native_mode && !millimeters.IsEmpty()) {
    screen.set_pixels_per_inch(
        display::kInchInMm * native_mode->size().width() / millimeters.width(),
        display::kInchInMm * native_mode->size().height() /
            millimeters.height());
  }

  // THE PANEL'S NAME LEAVES HERE OR IT DOES NOT LEAVE AT ALL, for the same
  // reason the millimeters above do: this display::Display is everything the
  // browser process ever learns about a snapshot, and the DisplaySnapshot
  // itself is inside //ui/ozone/platform/drm where //content cannot see it.
  // `label` is the field display::Display has for exactly this -- "a
  // user-friendly label, determined by the platform" -- and nothing on this
  // platform was setting it.
  //
  // Set only when there is something to say. An empty label is what every
  // display already has, and a display list where three monitors are all named
  // "" is worse than one where they are named by id: it looks like an answer.
  const std::string name = DisplayNameFromSnapshot(snapshot);
  if (!name.empty()) {
    screen.set_label(name);
  }
  return screen;
}

std::string DisplayNameFromSnapshot(const display::DisplaySnapshot& snapshot) {
  uint16_t manufacturer_id = 0;
  uint16_t product_id = 0;
  display::EdidParser::SplitProductCodeInManufacturerIdAndProductId(
      snapshot.product_code(), &manufacturer_id, &product_id);
  const std::string make =
      display::EdidParser::ManufacturerIdToString(manufacturer_id);

  // Three accessors and a join, and every decision in it is next door in
  // edid_name.cc -- which has no Chromium types in it and can therefore be
  // compiled and run outside a Chromium tree. That is the whole reason it is a
  // separate file: this one cannot be, and the parts of this worth testing are
  // the off-by-one in the descriptor walk and the four ways a name can be
  // partly missing.
  return DisplayNameFrom(IsPnpId(make) ? make : std::string(),
                         snapshot.display_name(),
                         SerialNumberFromEdid(snapshot.edid()));
}

gfx::Size DisplayPhysicalSizeMm(const display::DisplaySnapshot& snapshot) {
  return snapshot.physical_size();
}

std::vector<display::Display> DisplaysFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
    const std::vector<DomicileDisplayLayout>& layout) {
  if (snapshots.empty()) {
    return {display::Display(display::kDefaultDisplayId,
                             gfx::Rect(kDisplaylessBounds))};
  }

  std::vector<display::Display> displays;
  displays.reserve(snapshots.size());
  for (const display::DisplaySnapshot* snapshot : snapshots) {
    const DomicileDisplayLayout* wanted =
        WantedFor(layout, snapshot->display_id());
    displays.push_back(DisplayFromSnapshot(
        *snapshot, wanted ? wanted->origin : snapshot->origin()));
  }
  return displays;
}

size_t PrimaryIndexForLayout(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
    const std::vector<DomicileDisplayLayout>& layout) {
  if (layout.empty()) {
    return 0u;
  }
  size_t index = 0;
  for (const display::DisplaySnapshot* snapshot : snapshots) {
    const DomicileDisplayLayout* wanted =
        WantedFor(layout, snapshot->display_id());
    if (wanted && wanted->enabled) {
      return index;
    }
    ++index;
  }
  // A layout that lights nothing, which the compositor refuses to write: a
  // profile disabling every display it names leaves no desktop to put a window
  // on and is rejected where the config is parsed. Answered with the first
  // display rather than with nothing, because a list has to have a primary and
  // `GetPrimaryDisplay` CHECKs that it does.
  return 0u;
}

DrmScreen::DrmScreen(DrmWindowHostManager* window_manager)
    : window_manager_(window_manager) {}

DrmScreen::~DrmScreen() = default;

void DrmScreen::OnDisplaysChanged(
    const std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>&
        snapshots,
    const std::vector<DomicileDisplayLayout>& layout) {
  // A hotplug arrives as the whole list rather than as a delta, so what is
  // absent from it has been unplugged. DisplayList notifies its observers from
  // AddOrUpdateDisplay and RemoveDisplay, which is the whole of the hotplug
  // path -- there is no observer code of its own here.
  const std::vector<display::Display> displays =
      DisplaysFromSnapshots(snapshots, layout);

  // Not always the first snapshot: a profile that turns the laptop panel off
  // is the ordinary case on a full desk, and a primary that is dark is a
  // browser drawing onto a screen nobody can see. See `PrimaryIndexForLayout`.
  const size_t primary = PrimaryIndexForLayout(snapshots, layout);

  // THE PRIMARY GOES IN FIRST, and it is `DisplayList` that says so:
  // `AddDisplay` reads "the first display must be primary" and DCHECKs it,
  // and this build is `dcheck_always_on`. Filling the list in snapshot order
  // with the primary somewhere in the middle crashed the browser on the first
  // reading -- not on a hotplug, where the list is no longer empty, which is
  // exactly the kind of difference a test catches and a desk does not.
  //
  // It is also the order this list is documented to arrive in: the display
  // event's mojom says "the whole list, primary first", which before now was
  // true by accident because the primary was always snapshot zero.
  base::flat_set<int64_t> still_here;
  display_list_.AddOrUpdateDisplay(displays[primary],
                                   display::DisplayList::Type::PRIMARY);
  still_here.insert(displays[primary].id());
  size_t index = 0;
  for (const display::Display& display : displays) {
    if (index != primary) {
      display_list_.AddOrUpdateDisplay(
          display, display::DisplayList::Type::NOT_PRIMARY);
      still_here.insert(display.id());
    }
    ++index;
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
