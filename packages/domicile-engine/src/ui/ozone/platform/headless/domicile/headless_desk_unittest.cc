// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/headless/domicile/headless_desk.h"

#include <stdint.h>

#include <limits>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display.h"
#include "ui/gfx/display_color_spaces.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/ozone/public/ozone_platform.h"

namespace ui {
namespace {

// Virtual display ids have the top bit set, as the compositor picks them.
constexpr int64_t kPane1 = std::numeric_limits<int64_t>::min() | 1;
constexpr int64_t kPane2 = std::numeric_limits<int64_t>::min() | 2;

display::Display Placeholder() {
  return display::Display(7, gfx::Rect(0, 0, 1024, 768));
}

DomicileVirtualDisplay Pane(int64_t id, const gfx::Size& mode) {
  return {.id = id, .mode = mode, .refresh_mhz = 60000, .name = "Pane"};
}

TEST(HeadlessDeskTest, WithNoVirtualDisplaysTheDeskIsThePlaceholder) {
  const HeadlessDesk desk = HeadlessDeskOf(Placeholder(), {}, {});

  ASSERT_EQ(desk.displays.size(), 1u);
  EXPECT_EQ(desk.displays[0].id(), 7);
  EXPECT_EQ(desk.displays[0].bounds(), gfx::Rect(0, 0, 1024, 768));
  EXPECT_EQ(desk.connectors.at(7), kHeadlessPlaceholderConnector);
}

TEST(HeadlessDeskTest, AVirtualDisplayReplacesThePlaceholder) {
  const HeadlessDesk desk = HeadlessDeskOf(
      Placeholder(), {Pane(kPane1, gfx::Size(800, 600))}, {});

  ASSERT_EQ(desk.displays.size(), 1u);
  const display::Display& pane = desk.displays[0];
  EXPECT_EQ(pane.id(), kPane1);
  EXPECT_EQ(pane.bounds(), gfx::Rect(0, 0, 800, 600));
  EXPECT_EQ(pane.device_scale_factor(), 1.f);
  EXPECT_EQ(pane.display_frequency(), 60.f);
  EXPECT_EQ(pane.label(), "Pane");
  EXPECT_EQ(desk.connectors.size(), 1u);
  EXPECT_EQ(desk.connectors.at(kPane1), "virtual-1");
}

TEST(HeadlessDeskTest, DisplaysTheLayoutDoesNotNameGoLeftToRight) {
  const HeadlessDesk desk = HeadlessDeskOf(
      Placeholder(),
      {Pane(kPane1, gfx::Size(800, 600)), Pane(kPane2, gfx::Size(640, 480))},
      {});

  ASSERT_EQ(desk.displays.size(), 2u);
  EXPECT_EQ(desk.displays[0].bounds(), gfx::Rect(0, 0, 800, 600));
  EXPECT_EQ(desk.displays[1].bounds(), gfx::Rect(800, 0, 640, 480));
  EXPECT_EQ(desk.connectors.at(kPane2), "virtual-2");
}

TEST(HeadlessDeskTest, TheLayoutPlacesTheDisplaysItNames) {
  const HeadlessDesk desk = HeadlessDeskOf(
      Placeholder(),
      {Pane(kPane1, gfx::Size(800, 600)), Pane(kPane2, gfx::Size(640, 480))},
      {{.id = kPane2, .enabled = true, .origin = gfx::Point(0, 0)},
       {.id = kPane1, .enabled = true, .origin = gfx::Point(640, 0)}});

  ASSERT_EQ(desk.displays.size(), 2u);
  EXPECT_EQ(desk.displays[0].bounds(), gfx::Rect(640, 0, 800, 600));
  EXPECT_EQ(desk.displays[1].bounds(), gfx::Rect(0, 0, 640, 480));
}

TEST(HeadlessDeskTest, AnUnnamedDisplayGoesPastTheOnesTheLayoutPlaced) {
  const HeadlessDesk desk = HeadlessDeskOf(
      Placeholder(),
      {Pane(kPane1, gfx::Size(800, 600)), Pane(kPane2, gfx::Size(640, 480))},
      {{.id = kPane2, .enabled = true, .origin = gfx::Point(100, 0)}});

  ASSERT_EQ(desk.displays.size(), 2u);
  EXPECT_EQ(desk.displays[0].bounds(), gfx::Rect(740, 0, 800, 600))
      << "right of the 640-wide display the layout put at 100";
}

}  // namespace
}  // namespace ui
