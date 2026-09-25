// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/shell_windows.h"

#include <stdint.h>

#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display.h"
#include "ui/display/types/display_constants.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {
namespace {

// A monitor, as far as this decision is concerned. Only the id is read -- the
// rectangle is here because a display::Display without one is not a thing
// `display::Screen` ever hands over, and a fixture that omitted it would be
// asserting against a shape the caller never sees.
display::Display Monitor(int64_t id) {
  return display::Display(id, gfx::Rect(0, 0, 1920, 1080));
}

std::vector<int64_t> Ids(const std::vector<display::Display>& displays) {
  std::vector<int64_t> ids;
  for (const display::Display& display : displays) {
    ids.push_back(display.id());
  }
  return ids;
}

TEST(ShellWindowsTest, EveryMonitorOnAColdDeskWantsAWindow) {
  // Nothing is windowed yet, which is the browser before its first display
  // reading. IN THE DISPLAY LIST'S ORDER, so the primary -- which that list
  // puts first -- is opened first, and the desktop does not spend the
  // intervening frames on a screen that is about to stop being primary.
  const std::vector<display::Display> desk = {Monitor(1), Monitor(2),
                                              Monitor(3)};

  const ShellWindowPlan plan = ShellWindowsFor(desk, {});

  EXPECT_EQ(plan.open, Ids(desk));
  EXPECT_TRUE(plan.close.empty());
}

TEST(ShellWindowsTest, ADeskThatIsAlreadyRightIsLeftAlone) {
  // The case that runs on every hotplug for every monitor that did not move,
  // and the one this whole function exists to get right: closing and
  // reopening would reload the shell on each of them.
  const std::vector<display::Display> desk = {Monitor(1), Monitor(2)};

  const ShellWindowPlan plan = ShellWindowsFor(desk, {1, 2});

  EXPECT_TRUE(plan.open.empty());
  EXPECT_TRUE(plan.close.empty());
}

TEST(ShellWindowsTest, AMonitorPluggedInGetsAWindowAndNobodyElseMoves) {
  const ShellWindowPlan plan =
      ShellWindowsFor({Monitor(1), Monitor(2), Monitor(3)}, {1, 3});

  EXPECT_EQ(plan.open, std::vector<int64_t>({2}));
  EXPECT_TRUE(plan.close.empty());
}

TEST(ShellWindowsTest, AMonitorUnpluggedTakesItsWindowWithIt) {
  // Left open it would hold a frame sink and a renderer for a monitor nobody
  // can see, and it has no controller to scan out through either.
  const ShellWindowPlan plan = ShellWindowsFor({Monitor(1)}, {1, 2});

  EXPECT_TRUE(plan.open.empty());
  EXPECT_EQ(plan.close, std::vector<int64_t>({2}));
}

TEST(ShellWindowsTest, OneMonitorSwappedForAnotherIsBothHalvesAtOnce) {
  // A dock changed under a running desktop, which arrives as one reading
  // rather than as a removal followed by an addition. A plan that could only
  // answer one of the two would leave the desk wrong until something else
  // happened to ask again.
  const ShellWindowPlan plan =
      ShellWindowsFor({Monitor(1), Monitor(4)}, {1, 2});

  EXPECT_EQ(plan.open, std::vector<int64_t>({4}));
  EXPECT_EQ(plan.close, std::vector<int64_t>({2}));
}

TEST(ShellWindowsTest, NoDisplaysAtAllStillKeepsOneWindow) {
  // Every connector dark: a profile that disabled the last one, or a lid shut
  // on a laptop with nothing plugged in. THE LAST WINDOW STAYS, because
  // closing it is the browser exiting and the browser exiting is the session
  // ending -- a shut lid would log the user out rather than blank a screen.
  const ShellWindowPlan plan = ShellWindowsFor({}, {1, 2});

  EXPECT_TRUE(plan.open.empty());
  EXPECT_EQ(plan.close, std::vector<int64_t>({2}));
}

TEST(ShellWindowsTest, AWholeDeskSwappedAtOnceReplacesEveryWindow) {
  // A dock changed and every id is new, so there is nothing to keep: the
  // retention above is only for a plan with nothing to replace what it would
  // close. The caller opens before it closes, so the browser never passes
  // through zero windows even though every one of these is going.
  const ShellWindowPlan plan =
      ShellWindowsFor({Monitor(7), Monitor(8)}, {1, 2});

  EXPECT_EQ(plan.open, std::vector<int64_t>({7, 8}));
  EXPECT_EQ(plan.close, std::vector<int64_t>({1, 2}));
}

TEST(ShellWindowsTest, NothingWindowedAndNothingPluggedInIsNotACrash) {
  // The retention must not reach for a window that is not there. This is the
  // browser between losing its last display and being told about a new one.
  const ShellWindowPlan plan = ShellWindowsFor({}, {});

  EXPECT_TRUE(plan.open.empty());
  EXPECT_TRUE(plan.close.empty());
}

// A shell window the browser has right now, and the display its rectangle
// currently reads as. The number stands for a window the way the browser's
// pointer to it does; nothing here dereferences one.
SightedShellWindow Seen(uintptr_t window, int64_t nearest) {
  return SightedShellWindow{.window = window, .nearest = nearest};
}

TEST(ShellWindowPlacesTest, AWindowNobodyHasSeenIsWhereItsRectangleIs) {
  // The window startup opened, which this did not: there is no record of it,
  // and the desk is not moving when it is first read, so its own geometry is
  // the only answer there is and it is the right one.
  ShellWindowPlaces places;

  EXPECT_EQ(places.Update({Seen(1, 100), Seen(2, 200)}),
            std::vector<int64_t>({100, 200}));
}

TEST(ShellWindowPlacesTest, AWindowStaysOnTheDisplayItWasFirstSeenOn) {
  // THE BUG THIS CLASS EXISTS FOR. A hotplug moves the origins of the
  // displays before the windows on them are resized to follow, so a window
  // still at its old rectangle reads as being on the monitor that has just
  // taken that corner of the desk. Read fresh, the desk then looks like one
  // display with two windows and one with none: a duplicate window opens on
  // the first, the second stays dark because no window matches its rectangle
  // exactly, and the pages that result each claim a monitor that is not
  // theirs.
  ShellWindowPlaces places;
  places.Update({Seen(1, 100)});

  EXPECT_EQ(places.Update({Seen(1, 200), Seen(2, 200)}),
            std::vector<int64_t>({100, 200}));
}

TEST(ShellWindowPlacesTest, AWindowThatIsGoneIsForgotten) {
  // A renderer that died, a shell that navigated away, a monitor whose window
  // was closed. The browser hands out addresses again, so a record kept past
  // its window would place the next window at the last one's display -- which
  // is a monitor this believes is covered and leaves dark.
  ShellWindowPlaces places;
  places.Update({Seen(1, 100)});

  places.Update({});

  EXPECT_EQ(places.Update({Seen(1, 200)}), std::vector<int64_t>({200}));
}

TEST(ShellWindowPlacesTest, AWindowOpenedForADisplayIsOnItBeforeItIsSeen) {
  // A window is asked for and arrives later, and a second monitor can be
  // plugged in during that gap -- which is where reading the rectangle is
  // least reliable and where the window's display is least in doubt, because
  // this is the side that asked for it. Told outright, it never has to be
  // guessed at all.
  ShellWindowPlaces places;

  places.Place(1, 100);

  EXPECT_EQ(places.Update({Seen(1, 200)}), std::vector<int64_t>({100}));
}

TEST(ShellWindowPlacesTest, TheDisplayAWindowIsOnCanBeAskedForOnItsOwn) {
  // What names a page's screen. It is the same answer the reconciliation
  // works from, and it has to be: a page told one monitor and a window opened
  // for another is a monitor showing another monitor's desktop.
  ShellWindowPlaces places;
  places.Update({Seen(1, 100)});

  EXPECT_EQ(places.Of(1), 100);
  EXPECT_EQ(places.Of(2), display::kInvalidDisplayId);
}

}  // namespace
}  // namespace domicile
