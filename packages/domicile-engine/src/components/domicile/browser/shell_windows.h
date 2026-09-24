// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOWS_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOWS_H_

#include <stdint.h>

#include <vector>

#include "base/containers/flat_map.h"
#include "ui/display/display.h"
#include "ui/display/types/display_constants.h"

namespace domicile {

// Which shell windows to open and which to close, so that every display this
// browser scans out to has exactly one.
//
// ONE WINDOW CANNOT COVER TWO MONITORS, which is why a desk of several needs
// several. `ScreenManager::FindWindowAt` binds a window to a display
// controller only on an EXACT rectangle match against
// `gfx::Rect(controller->origin(), controller->GetModeSize())`, so a window
// stretched across two CRTCs matches neither and is scanned out by neither.
// The answer is one browser window per CRTC, and this is the part of it that
// is a decision rather than plumbing.
//
// A RECONCILIATION RATHER THAN A SETUP STEP, because monitors come and go. A
// function that only opened windows would be correct exactly once -- at
// startup, on the desk that happened to be plugged in -- and every hotplug
// after it would leave either a monitor with nothing drawn on it or a window
// on a display that is gone. So this answers the whole question every time it
// is asked: what is missing, and what is left over.
struct ShellWindowPlan {
  // Displays with no window, in the order the display list gives them. The
  // first display is the primary one -- see `PrimaryIndexForLayout` in
  // ui/ozone/platform/drm/domicile/drm_screen.cc -- so the primary's window is
  // opened first on a cold start, and the desktop does not spend the
  // intervening frames on a screen that is about to stop being primary.
  std::vector<int64_t> open;
  // Windows whose display is no longer there. Closed rather than left: a
  // window on a display that is gone has no controller, holds a frame sink and
  // a renderer for a monitor nobody can see, and would take the shell's
  // keyboard focus with it if it happened to be the active one.
  //
  // NEVER ALL OF THEM AT ONCE. The last browser window closing is the browser
  // exiting, and the browser exiting is the desktop ending -- so a lid shut on
  // a laptop with nothing plugged in would log the session out rather than
  // blank a screen. One window is kept when there is nothing to replace it
  // with, drawing to a display that is not there until one is, which costs a
  // frame sink nobody sees and keeps every client and everything the shell
  // holds alive across the dark.
  std::vector<int64_t> close;
};

// `displays` is what `display::Screen` reports now; `windowed` is the display
// each shell window the browser already has is on.
//
// A DISPLAY THAT ALREADY HAS A WINDOW IS LEFT ALONE, and that is the rule this
// is written around rather than an optimization. Closing and reopening would
// reload the shell on every hotplug -- every embedded page back to where it
// started, every portal re-created blank -- which is the same cost
// `<Screen>` keys its regions by position to avoid, and it would be paid on
// the ordinary act of plugging in a monitor.
//
// Says nothing about a display whose BOUNDS changed. That is a window that
// exists and should stay, resized by its caller: the exact-rect rule above
// makes a stale window a black screen, so a mode change or a profile moving a
// monitor is a re-fullscreen rather than an open or a close.
//
// THE CALLER OPENS BEFORE IT CLOSES, and that ordering is this function's to
// state because the reason for it is here. A desk whose monitors were all
// swapped at once -- a dock changed, every id new -- is a plan that closes as
// many windows as it opens, and closing first would pass through zero windows,
// which is the browser exiting. Opening first never does.
ShellWindowPlan ShellWindowsFor(const std::vector<display::Display>& displays,
                                const std::vector<int64_t>& windowed);

// One shell window the browser has right now: which window it is, and which
// display its rectangle currently reads as being on.
//
// `window` is an identity and nothing more -- the browser's own pointer to the
// window, as a number so that nothing here can dereference one. What it is for
// is telling this window from that one across a reconciliation, and a
// `uintptr_t` says so in the type.
struct SightedShellWindow {
  uintptr_t window = 0;
  int64_t nearest = display::kInvalidDisplayId;
};

// Which display each shell window is on: the one it was first seen on, not the
// one its rectangle reads as now.
//
// READING THE RECTANGLE FRESH EVERY TIME IS WRONG, and it is wrong exactly
// when it matters. A hotplug moves the origins of the displays before the
// windows on them are resized to follow, so a window still at its old
// rectangle reads as being on the monitor that has just taken that corner of
// the desk. The desk then looks like one display with two windows and one with
// none: `ShellWindowsFor` opens a duplicate on the first, the second stays
// dark -- `ScreenManager::FindWindowAt` matches a window to a controller on
// an exact rectangle and nothing matches its -- and each page then names a
// monitor that is not the one it is on.
//
// A window never moves between displays. Nothing here asks it to: a display
// that is gone takes its window with it, and a display that moved is a window
// resized onto the same display. So what a window was opened for is what it
// is on, for as long as it exists, and remembering that is the whole of this.
//
// NOT A MAP THAT HAS TO BE TOLD. A window can close on its own -- a renderer
// that died, a shell that navigated away -- and a record kept past its window
// would place the browser's next window at the last one's display, which is a
// monitor this believes is covered and leaves dark. So every record is
// re-derived from the windows the browser actually has, on every read.
class ShellWindowPlaces {
 public:
  ShellWindowPlaces();

  ShellWindowPlaces(const ShellWindowPlaces&) = delete;
  ShellWindowPlaces& operator=(const ShellWindowPlaces&) = delete;

  ~ShellWindowPlaces();

  // Record that `window` was opened for `display`, before any reading of the
  // desk has seen it. What asks is the side that opened it: a window arrives
  // asynchronously and a monitor can be plugged in during that gap, which is
  // where a rectangle is least reliable and where the display is least in
  // doubt.
  void Place(uintptr_t window, int64_t display);

  // The display each of `live` is on, in the order given, which is what
  // `ShellWindowsFor` takes as `windowed`. A window seen for the first time is
  // recorded where its rectangle is -- there is nothing else to go on, and a
  // desk is not moving when the window startup opened is first read. Records
  // for windows not in `live` are forgotten.
  std::vector<int64_t> Update(const std::vector<SightedShellWindow>& live);

  // The display `window` is on, or `display::kInvalidDisplayId` for a window
  // no `Update` has seen. What names a page's screen -- the same answer the
  // reconciliation works from, because a page told one monitor and a window
  // opened for another is a monitor showing another monitor's desktop.
  int64_t Of(uintptr_t window) const;

 private:
  base::flat_map<uintptr_t, int64_t> placed_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOWS_H_
