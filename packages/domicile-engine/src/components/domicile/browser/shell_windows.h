// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOWS_H_
#define COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOWS_H_

#include <stdint.h>

#include <vector>

#include "ui/display/display.h"

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

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHELL_WINDOWS_H_
