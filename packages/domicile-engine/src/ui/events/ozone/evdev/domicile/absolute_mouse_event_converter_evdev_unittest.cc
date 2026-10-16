// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/absolute_mouse_event_converter_evdev.h"

#include <linux/input.h>

#include <iterator>
#include <memory>
#include <vector>

#include "base/check.h"
#include "base/containers/flat_map.h"
#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/notreached.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/devices/gamepad_device.h"
#include "ui/events/devices/input_device.h"
#include "ui/events/devices/keyboard_device.h"
#include "ui/events/devices/stylus_state.h"
#include "ui/events/devices/touchpad_device.h"
#include "ui/events/devices/touchscreen_device.h"
#include "ui/events/ozone/evdev/cursor_delegate_evdev.h"
#include "ui/events/ozone/evdev/device_event_dispatcher_evdev.h"
#include "ui/events/ozone/evdev/event_device_info.h"
#include "ui/events/ozone/evdev/event_device_test_util.h"
#include "ui/events/ozone/gamepad/gamepad_event.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/vector2d.h"

namespace ui {
namespace {

// QEMU 10.2's `usb-tablet`: absolute X and Y, five mouse buttons and a wheel,
// with no relative X or Y and no `BTN_TOUCH`. Key, rel and abs bits are from a
// trace of one; the rest are what hid-generic gives such a device.
const DeviceAbsoluteAxis kQemuUsbTabletAbsAxes[] = {
    {ABS_X, {0, 0, 32767, 0, 0, 0}},
    {ABS_Y, {0, 0, 32767, 0, 0, 0}},
};
const DeviceCapabilities kQemuUsbTablet = {
    /* path */
    "/sys/devices/pci0000:00/0000:00:04.0/usb2/2-1/2-1:1.0/"
    "0003:0627:0001.0001/input/input4/event4",
    /* name */ "QEMU QEMU USB Tablet",
    /* phys */ "usb-0000:00:04.0-1/input0",
    /* uniq */ "28754-0000:00:04.0-1",
    /* bustype */ "0003",
    /* vendor */ "0627",
    /* product */ "0001",
    /* version */ "0001",
    /* prop */ "0",
    /* ev */ "1f",
    /* key */ "1f0000 0 0 0 0",
    /* rel */ "900",
    /* abs */ "3",
    /* msc */ "10",
    /* sw */ "0",
    /* led */ "0",
    /* ff */ "0",
    kQemuUsbTabletAbsAxes,
    std::size(kQemuUsbTabletAbsAxes),
};

std::unique_ptr<EventDeviceInfo> Info(const DeviceCapabilities& capabilities) {
  auto info = std::make_unique<EventDeviceInfo>();
  CHECK(CapabilitiesToDeviceInfo(capabilities, info.get()));
  return info;
}

TEST(AbsoluteMouseDeviceTest, AQemuTabletIsAnAbsoluteMouse) {
  const std::unique_ptr<EventDeviceInfo> info = Info(kQemuUsbTablet);

  EXPECT_TRUE(info->HasAbsoluteMouse());
  EXPECT_FALSE(info->HasTouchscreen());
  EXPECT_FALSE(info->HasTouchpad());
  EXPECT_FALSE(info->HasTablet());
  // `HasMouse` is a relative mouse, which libinput takes.
  EXPECT_FALSE(info->HasMouse());
}

// The Elo clicks with `BTN_LEFT` alone: a touch is one button. A pen, a
// touchscreen and a denylisted absolute mouse keep upstream's reading.
TEST(AbsoluteMouseDeviceTest, OnlyAPointerWithASecondButtonIsOne) {
  EXPECT_TRUE(Info(kElo_TouchSystems_2700)->HasTouchscreen());
  EXPECT_TRUE(Info(kMimoTouch2Touchscreen)->HasTouchscreen());
  EXPECT_TRUE(Info(kWacomIntuosPtS_Pen)->HasTablet());
  for (const DeviceCapabilities* capabilities :
       {&kElo_TouchSystems_2700, &kMimoTouch2Touchscreen,
        &kWacomIntuosPtS_Pen, &kIlitekTP_Mouse, &kLogitechUsbMouse}) {
    EXPECT_FALSE(Info(*capabilities)->HasAbsoluteMouse())
        << capabilities->name;
  }
}

constexpr int kId = 7;

// The display a tablet is bound to: the right of two heads.
constexpr gfx::Rect kBound(1920, 0, 1280, 800);

// Puts the pointer where it is told, and gives every device `kBound`.
class FakeCursor : public CursorDelegateEvdev {
 public:
  void MoveCursorTo(gfx::AcceleratedWidget, const gfx::PointF&) override {
    NOTREACHED();
  }
  void MoveCursorTo(const gfx::PointF& location) override {
    location_ = location;
  }
  void MoveCursor(const gfx::Vector2dF&) override { NOTREACHED(); }
  bool IsCursorVisible() override { return true; }
  gfx::PointF GetLocation() override { return location_; }
  gfx::Rect GetCursorConfinedBounds() override { return gfx::Rect(); }
  gfx::Rect GetDomicileAbsoluteArea(int device_id) override {
    return device_id == kId ? kBound : gfx::Rect();
  }
  void InitializeOnEvdev() override {}

 private:
  gfx::PointF location_;
};

// Keeps every mouse event it is given.
class FakeDispatcher : public DeviceEventDispatcherEvdev {
 public:
  std::vector<MouseMoveEventParams> moves;
  std::vector<MouseButtonEventParams> buttons;
  std::vector<MouseWheelEventParams> wheels;

  void DispatchMouseMoveEvent(const MouseMoveEventParams& params) override {
    moves.push_back(params);
  }
  void DispatchMouseButtonEvent(const MouseButtonEventParams& params) override {
    buttons.push_back(params);
  }
  void DispatchMouseWheelEvent(const MouseWheelEventParams& params) override {
    wheels.push_back(params);
  }

  void DispatchKeyEvent(const KeyEventParams&) override { NOTREACHED(); }
  void DispatchPinchEvent(const PinchEventParams&) override { NOTREACHED(); }
  void DispatchScrollEvent(const ScrollEventParams&) override { NOTREACHED(); }
  void DispatchTouchEvent(const TouchEventParams&) override { NOTREACHED(); }
  void DispatchGamepadEvent(const GamepadEvent&) override { NOTREACHED(); }
  void DispatchMicrophoneMuteSwitchValueChanged(bool) override {
    NOTREACHED();
  }
  void DispatchAnyKeysPressedUpdated(bool) override { NOTREACHED(); }
  void DispatchKeyboardDevicesUpdated(
      const std::vector<KeyboardDevice>&,
      base::flat_map<int, std::vector<uint64_t>>) override {}
  void DispatchTouchscreenDevicesUpdated(
      const std::vector<TouchscreenDevice>&) override {}
  void DispatchMouseDevicesUpdated(const std::vector<InputDevice>&,
                                   bool) override {}
  void DispatchPointingStickDevicesUpdated(
      const std::vector<InputDevice>&) override {}
  void DispatchTouchpadDevicesUpdated(const std::vector<TouchpadDevice>&,
                                      bool) override {}
  void DispatchGraphicsTabletDevicesUpdated(
      const std::vector<InputDevice>&) override {}
  void DispatchDeviceListsComplete() override {}
  void DispatchStylusStateChanged(StylusState) override {}
  void DispatchGamepadDevicesUpdated(
      const std::vector<GamepadDevice>&,
      base::flat_map<int, std::vector<uint64_t>>) override {}
  void DispatchUncategorizedDevicesUpdated(
      const std::vector<InputDevice>&) override {}
};

input_event Event(int type, int code, int value) {
  input_event event = {};
  event.type = type;
  event.code = code;
  event.value = value;
  return event;
}

input_event Sync() {
  return Event(EV_SYN, SYN_REPORT, 0);
}

// The middle of the tablet's 0..32767 range.
input_event MiddleX() {
  return Event(EV_ABS, ABS_X, 16384);
}
input_event MiddleY() {
  return Event(EV_ABS, ABS_Y, 16384);
}

class AbsoluteMouseConverterTest : public testing::Test {
 protected:
  AbsoluteMouseConverterTest()
      : info_(Info(kQemuUsbTablet)),
        converter_(base::ScopedFD(),
                   base::FilePath("/dev/input/event4"),
                   kId,
                   &cursor_,
                   *info_,
                   &dispatcher_) {}

  void Process(const std::vector<input_event>& events) {
    converter_.ProcessEvents(events);
  }

  FakeCursor cursor_;
  FakeDispatcher dispatcher_;
  const std::unique_ptr<EventDeviceInfo> info_;
  AbsoluteMouseEventConverterEvdev converter_;
};

TEST_F(AbsoluteMouseConverterTest, IsAMouse) {
  EXPECT_TRUE(converter_.HasMouse());
  EXPECT_FALSE(converter_.HasTouchscreen());
}

TEST_F(AbsoluteMouseConverterTest, AMoveWithNoButtonHoversOnTheBoundDisplay) {
  Process({MiddleX(), MiddleY(), Sync()});

  EXPECT_EQ(cursor_.GetLocation(), gfx::PointF(2560, 400));
  ASSERT_EQ(dispatcher_.moves.size(), 1u);
  EXPECT_EQ(dispatcher_.moves[0].location, gfx::PointF(2560, 400));
  EXPECT_EQ(dispatcher_.moves[0].pointer_details.pointer_type,
            EventPointerType::kMouse);
  EXPECT_TRUE(dispatcher_.buttons.empty());
}

TEST_F(AbsoluteMouseConverterTest, EveryButtonIsAMouseButton) {
  Process({Event(EV_KEY, BTN_RIGHT, 1), Sync(), Event(EV_KEY, BTN_RIGHT, 0),
           Sync(), Event(EV_KEY, BTN_MIDDLE, 1), Sync()});

  ASSERT_EQ(dispatcher_.buttons.size(), 3u);
  EXPECT_EQ(dispatcher_.buttons[0].button, static_cast<unsigned>(BTN_RIGHT));
  EXPECT_TRUE(dispatcher_.buttons[0].down);
  EXPECT_FALSE(dispatcher_.buttons[1].down);
  EXPECT_EQ(dispatcher_.buttons[2].button, static_cast<unsigned>(BTN_MIDDLE));
  // Remappable, as any mouse's: a left-handed setting swaps them.
  EXPECT_EQ(dispatcher_.buttons[0].map_type, MouseButtonMapType::kMouse);
  EXPECT_EQ(dispatcher_.buttons[0].pointer_details.pointer_type,
            EventPointerType::kMouse);
}

// A device may report the position and the press in one frame. The pointer
// moves there first, so the press lands where it was made.
TEST_F(AbsoluteMouseConverterTest, APressInTheFrameOfAMoveLandsAtTheMove) {
  Process({MiddleX(), MiddleY(), Event(EV_KEY, BTN_LEFT, 1), Sync()});

  ASSERT_EQ(dispatcher_.moves.size(), 1u);
  ASSERT_EQ(dispatcher_.buttons.size(), 1u);
  EXPECT_EQ(dispatcher_.buttons[0].location, gfx::PointF(2560, 400));
}

// The kernel sends a notch as `REL_WHEEL` and `REL_WHEEL_HI_RES` both. Down
// is negative in each, and in Chromium.
TEST_F(AbsoluteMouseConverterTest, AWheelNotchScrollsOneNotch) {
  Process({MiddleX(), MiddleY(), Sync(), Event(EV_REL, REL_WHEEL, -1),
           Event(EV_REL, REL_WHEEL_HI_RES, -120), Sync()});

  ASSERT_EQ(dispatcher_.wheels.size(), 1u);
  EXPECT_EQ(dispatcher_.wheels[0].delta, gfx::Vector2d(0, -120));
  EXPECT_EQ(dispatcher_.wheels[0].tick_120ths, gfx::Vector2d(0, -120));
  EXPECT_EQ(dispatcher_.wheels[0].location, gfx::PointF(2560, 400));
}

// A free-spinning wheel reports parts of a notch. Right is positive in evdev
// and negative in Chromium.
TEST_F(AbsoluteMouseConverterTest, AHighResolutionWheelScrollsPartOfANotch) {
  Process({Event(EV_REL, REL_WHEEL_HI_RES, 30), Sync(),
           Event(EV_REL, REL_HWHEEL, 1), Event(EV_REL, REL_HWHEEL_HI_RES, 60),
           Sync()});

  ASSERT_EQ(dispatcher_.wheels.size(), 2u);
  EXPECT_EQ(dispatcher_.wheels[0].delta, gfx::Vector2d(0, 30));
  EXPECT_EQ(dispatcher_.wheels[1].delta, gfx::Vector2d(-60, 0));
}

// A wheel without the high-resolution axes, as on a kernel before 5.0.
TEST_F(AbsoluteMouseConverterTest, AWheelWithoutHighResolutionIsWholeNotches) {
  Process({Event(EV_REL, REL_WHEEL, -1), Sync(), Event(EV_REL, REL_HWHEEL, 1),
           Sync()});

  ASSERT_EQ(dispatcher_.wheels.size(), 2u);
  EXPECT_EQ(dispatcher_.wheels[0].delta, gfx::Vector2d(0, -120));
  EXPECT_EQ(dispatcher_.wheels[1].delta, gfx::Vector2d(-120, 0));
}

}  // namespace
}  // namespace ui
