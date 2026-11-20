// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/cursor_display.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display.h"

namespace domicile {
namespace {

display::Display Laptop() {
  display::Display laptop(1);
  laptop.set_device_scale_factor(1.5f);
  return laptop;
}

TEST(CursorDisplayTest, TheHostsOwnDisplayIsCurrent) {
  EXPECT_FALSE(CursorDisplayStale(Laptop(), Laptop()));
}

// A hotplug can hand the cursor a display that is not valid, at scale 1, and
// nothing hands it another until the pointer enters a new window.
TEST(CursorDisplayTest, ADisplayFromMidHotplugIsStale) {
  EXPECT_TRUE(CursorDisplayStale(display::Display(), Laptop()));
}

TEST(CursorDisplayTest, TheSameDisplayAtANewScaleIsStale) {
  display::Display was = Laptop();
  was.set_device_scale_factor(1.0f);
  EXPECT_TRUE(CursorDisplayStale(was, Laptop()));
}

TEST(CursorDisplayTest, TheSameDisplayTurnedIsStale) {
  display::Display was = Laptop();
  was.set_panel_rotation(display::Display::ROTATE_270);
  EXPECT_TRUE(CursorDisplayStale(was, Laptop()));
}

}  // namespace
}  // namespace domicile
