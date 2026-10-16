// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_pointer_targets.h"

#include <string>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/files/file_path.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display.h"
#include "ui/events/devices/input_device.h"
#include "ui/events/devices/touch_device_transform.h"
#include "ui/events/devices/touchscreen_device.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/ozone/public/ozone_platform.h"

namespace ui {
namespace {

// QEMU's USB tablet: one per head, every one with the same name.
constexpr char kTablet[] = "QEMU QEMU USB Tablet";
constexpr char kFirstPhys[] = "usb-0000:00:04.0-1/input0";
constexpr char kSecondPhys[] = "usb-0000:00:04.0-2/input0";
constexpr int kFirst = 10;
constexpr int kSecond = 11;

constexpr int64_t kLeft = 1;
constexpr int64_t kRight = 2;

// Two heads in the engine's row.
std::vector<display::Display> Heads() {
  return {display::Display(kLeft, gfx::Rect(0, 0, 1920, 1080)),
          display::Display(kRight, gfx::Rect(1920, 0, 1280, 800))};
}

InputDevice Device(int id, const std::string& phys) {
  return InputDevice(id, INPUT_DEVICE_USB, kTablet, phys, base::FilePath(),
                     /*vendor=*/0x0627, /*product=*/0x0001, /*version=*/0);
}

// A tablet whose `ABS_X` and `ABS_Y` run 0..32767, as QEMU's do.
TouchscreenDevice Tablet(int id, const std::string& phys) {
  return TouchscreenDevice(Device(id, phys), gfx::Size(32768, 32768),
                           /*touch_points=*/1);
}

std::vector<TouchscreenDevice> BothTablets() {
  return {Tablet(kFirst, kFirstPhys), Tablet(kSecond, kSecondPhys)};
}

TEST(DrmPointerTargetsTest, ATabletCoversTheDisplayItIsBoundTo) {
  const std::vector<TouchDeviceTransform> transforms = TouchTransformsFor(
      BothTablets(), {{.device = kSecondPhys, .display_id = kRight}}, Heads());

  ASSERT_EQ(transforms.size(), 1u);
  EXPECT_EQ(transforms[0].device_id, kSecond);
  EXPECT_EQ(transforms[0].display_id, kRight);
  // Its corner is the display's corner, and its middle the display's middle.
  EXPECT_EQ(transforms[0].transform.MapPoint(gfx::PointF(0, 0)),
            gfx::PointF(1920, 0));
  EXPECT_EQ(transforms[0].transform.MapPoint(gfx::PointF(16384, 16384)),
            gfx::PointF(2560, 400));
}

TEST(DrmPointerTargetsTest, ASharedNameBindsEveryDeviceWithIt) {
  const std::vector<TouchDeviceTransform> transforms = TouchTransformsFor(
      BothTablets(), {{.device = kTablet, .display_id = kLeft}}, Heads());

  ASSERT_EQ(transforms.size(), 2u);
  EXPECT_EQ(transforms[0].device_id, kFirst);
  EXPECT_EQ(transforms[1].device_id, kSecond);
  EXPECT_EQ(transforms[1].display_id, kLeft);
}

TEST(DrmPointerTargetsTest, TheFirstTargetThatNamesADeviceWins) {
  const std::vector<TouchDeviceTransform> transforms =
      TouchTransformsFor({Tablet(kFirst, kFirstPhys)},
                         {{.device = kFirstPhys, .display_id = kRight},
                          {.device = kTablet, .display_id = kLeft}},
                         Heads());

  ASSERT_EQ(transforms.size(), 1u);
  EXPECT_EQ(transforms[0].display_id, kRight);
}

TEST(DrmPointerTargetsTest, AnUnboundTabletOrAnUnpluggedDisplayBindsNothing) {
  EXPECT_TRUE(
      TouchTransformsFor({Tablet(kFirst, kFirstPhys)}, {}, Heads()).empty());
  EXPECT_TRUE(TouchTransformsFor({Tablet(kFirst, kFirstPhys)},
                                 {{.device = kTablet, .display_id = 9}},
                                 Heads())
                  .empty());
}

// QEMU's tablet read as an absolute mouse moves the pointer itself, so it
// takes its display's rectangle rather than a touch transform.
TEST(DrmPointerTargetsTest, AnAbsoluteMouseCoversTheDisplayItIsBoundTo) {
  const std::vector<InputDevice> mice = {Device(kFirst, kFirstPhys),
                                         Device(kSecond, kSecondPhys)};

  EXPECT_EQ(AbsoluteAreasFor(mice,
                             {{.device = kSecondPhys, .display_id = kRight}},
                             Heads()),
            (base::flat_map<int, gfx::Rect>{
                {kSecond, gfx::Rect(1920, 0, 1280, 800)}}));
}

}  // namespace
}  // namespace ui
