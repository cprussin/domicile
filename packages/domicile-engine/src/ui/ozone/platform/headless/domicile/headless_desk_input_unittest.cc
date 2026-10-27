// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/headless/domicile/headless_desk_input.h"

#include <memory>
#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/ozone/layout/stub/stub_keyboard_layout_engine.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/vector2d.h"
#include "ui/ozone/public/ozone_platform.h"

namespace ui {
namespace {

// evdev codes, as an EIS client sends them.
constexpr uint32_t kBtnLeft = 0x110;
constexpr uint32_t kBtnRight = 0x111;
constexpr uint32_t kBtnMiddle = 0x112;
constexpr uint32_t kBtnSide = 0x113;
constexpr uint32_t kBtnExtra = 0x114;
constexpr uint32_t kKeyA = 30;
constexpr uint32_t kKeyLeftShift = 42;
constexpr uint32_t kKeyLeftCtrl = 29;

DomicileDeskInput PointerAt(double x, double y) {
  return {.kind = DomicileDeskInput::Kind::kPointer, .x = x, .y = y};
}

DomicileDeskInput Button(uint32_t code, bool pressed) {
  return {.kind = DomicileDeskInput::Kind::kButton,
          .code = code,
          .pressed = pressed};
}

DomicileDeskInput Key(uint32_t code, bool pressed) {
  return {
      .kind = DomicileDeskInput::Kind::kKey, .code = code, .pressed = pressed};
}

DomicileDeskInput Scroll(double x, double y) {
  return {.kind = DomicileDeskInput::Kind::kScroll, .x = x, .y = y};
}

class HeadlessDeskInputTest : public testing::Test {
 protected:
  HeadlessDeskInputTest()
      : input_(base::BindRepeating(&HeadlessDeskInputTest::Heard,
                                   base::Unretained(this)),
               &layout_) {}

  void Heard(Event* event) { heard_.push_back(event->Clone()); }

  const MouseEvent& Mouse(size_t index) {
    return *heard_.at(index)->AsMouseEvent();
  }

  const KeyEvent& Keyed(size_t index) { return *heard_.at(index)->AsKeyEvent(); }

  StubKeyboardLayoutEngine layout_;
  HeadlessDeskInput input_;
  std::vector<std::unique_ptr<Event>> heard_;
};

TEST_F(HeadlessDeskInputTest, ThePointerMovesToThePoint) {
  input_.Inject(PointerAt(100, 50));

  ASSERT_EQ(heard_.size(), 1u);
  EXPECT_EQ(Mouse(0).type(), EventType::kMouseMoved);
  EXPECT_EQ(Mouse(0).location_f(), gfx::PointF(100, 50));
  EXPECT_EQ(Mouse(0).root_location_f(), gfx::PointF(100, 50));
}

TEST_F(HeadlessDeskInputTest, AButtonPressesAndReleasesWhereThePointerIs) {
  input_.Inject(PointerAt(10, 20));
  input_.Inject(Button(kBtnLeft, true));
  input_.Inject(Button(kBtnLeft, false));

  ASSERT_EQ(heard_.size(), 3u);
  EXPECT_EQ(Mouse(1).type(), EventType::kMousePressed);
  EXPECT_EQ(Mouse(1).location_f(), gfx::PointF(10, 20));
  EXPECT_EQ(Mouse(1).changed_button_flags(), EF_LEFT_MOUSE_BUTTON);
  EXPECT_TRUE(Mouse(1).flags() & EF_LEFT_MOUSE_BUTTON);
  EXPECT_EQ(Mouse(2).type(), EventType::kMouseReleased);
  EXPECT_EQ(Mouse(2).changed_button_flags(), EF_LEFT_MOUSE_BUTTON);
}

TEST_F(HeadlessDeskInputTest, MotionWithAButtonHeldDrags) {
  input_.Inject(Button(kBtnLeft, true));
  input_.Inject(PointerAt(30, 40));
  input_.Inject(Button(kBtnLeft, false));
  input_.Inject(PointerAt(31, 40));

  ASSERT_EQ(heard_.size(), 4u);
  EXPECT_EQ(Mouse(1).type(), EventType::kMouseDragged);
  EXPECT_TRUE(Mouse(1).flags() & EF_LEFT_MOUSE_BUTTON);
  EXPECT_EQ(Mouse(3).type(), EventType::kMouseMoved);
  EXPECT_FALSE(Mouse(3).flags() & EF_LEFT_MOUSE_BUTTON);
}

TEST_F(HeadlessDeskInputTest, EachButtonIsItsOwn) {
  for (uint32_t code : {kBtnRight, kBtnMiddle, kBtnSide, kBtnExtra}) {
    input_.Inject(Button(code, true));
  }

  ASSERT_EQ(heard_.size(), 4u);
  EXPECT_EQ(Mouse(0).changed_button_flags(), EF_RIGHT_MOUSE_BUTTON);
  EXPECT_EQ(Mouse(1).changed_button_flags(), EF_MIDDLE_MOUSE_BUTTON);
  EXPECT_EQ(Mouse(2).changed_button_flags(), EF_BACK_MOUSE_BUTTON);
  EXPECT_EQ(Mouse(3).changed_button_flags(), EF_FORWARD_MOUSE_BUTTON);
}

TEST_F(HeadlessDeskInputTest, AButtonNoMouseHasIsDropped) {
  input_.Inject(Button(0x120, true));

  EXPECT_TRUE(heard_.empty());
}

TEST_F(HeadlessDeskInputTest, AScrollDownIsAWheelTurnedTowardTheUser) {
  // One detent is 15 pixels, as the compositor converts a wheel click, and
  // 120 to Chrome. A positive Chrome offset scrolls up.
  input_.Inject(PointerAt(5, 6));
  input_.Inject(Scroll(0, 15));

  ASSERT_EQ(heard_.size(), 2u);
  ASSERT_EQ(heard_[1]->type(), EventType::kMousewheel);
  const MouseWheelEvent& wheel = *heard_[1]->AsMouseWheelEvent();
  EXPECT_EQ(wheel.offset(), gfx::Vector2d(0, -120));
  EXPECT_EQ(wheel.location_f(), gfx::PointF(5, 6));
}

TEST_F(HeadlessDeskInputTest, AKeyTypesWhatTheLayoutSays) {
  input_.Inject(Key(kKeyA, true));
  input_.Inject(Key(kKeyA, false));

  ASSERT_EQ(heard_.size(), 2u);
  EXPECT_EQ(Keyed(0).type(), EventType::kKeyPressed);
  EXPECT_EQ(Keyed(0).code(), DomCode::US_A);
  EXPECT_EQ(Keyed(0).GetDomKey(), DomKey::FromCharacter('a'));
  EXPECT_EQ(Keyed(1).type(), EventType::kKeyReleased);
}

TEST_F(HeadlessDeskInputTest, ShiftHeldTypesTheShiftedKey) {
  input_.Inject(Key(kKeyLeftShift, true));
  input_.Inject(Key(kKeyA, true));
  input_.Inject(Key(kKeyA, false));
  input_.Inject(Key(kKeyLeftShift, false));
  input_.Inject(Key(kKeyA, true));

  ASSERT_EQ(heard_.size(), 5u);
  EXPECT_TRUE(Keyed(1).flags() & EF_SHIFT_DOWN);
  EXPECT_EQ(Keyed(1).GetDomKey(), DomKey::FromCharacter('A'));
  EXPECT_FALSE(Keyed(4).flags() & EF_SHIFT_DOWN);
  EXPECT_EQ(Keyed(4).GetDomKey(), DomKey::FromCharacter('a'));
}

TEST_F(HeadlessDeskInputTest, AClickCarriesTheModifiersHeld) {
  input_.Inject(Key(kKeyLeftCtrl, true));
  input_.Inject(Button(kBtnLeft, true));

  ASSERT_EQ(heard_.size(), 2u);
  EXPECT_TRUE(Mouse(1).flags() & EF_CONTROL_DOWN);
}

TEST_F(HeadlessDeskInputTest, AKeyNoKeyboardHasIsDropped) {
  input_.Inject(Key(0, true));

  EXPECT_TRUE(heard_.empty());
}

}  // namespace
}  // namespace ui
