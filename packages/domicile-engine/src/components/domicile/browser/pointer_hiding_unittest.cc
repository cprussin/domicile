// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/pointer_hiding.h"

#include <string>
#include <vector>

#include "base/test/task_environment.h"
#include "base/time/time.h"
#include "components/domicile/browser/desk_pointer_hiding.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/gesture_event_details.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/events/types/event_type.h"
#include "ui/gfx/geometry/point_f.h"

namespace domicile {
namespace {

using Heard = std::vector<std::string>;

class RecordingPointer : public PointerHiding::Pointer {
 public:
  void Hide() override { heard_.push_back("hide"); }
  void Show() override { heard_.push_back("show"); }

  Heard Take() { return std::exchange(heard_, {}); }

 private:
  Heard heard_;
};

ui::KeyEvent Key(ui::KeyboardCode code, int flags = ui::EF_NONE) {
  return ui::KeyEvent(ui::EventType::kKeyPressed, code, flags);
}

ui::MouseEvent Mouse(ui::EventType type,
                     int flags = ui::EF_NONE,
                     int changed = ui::EF_NONE) {
  return ui::MouseEvent(type, gfx::PointF(10, 10), gfx::PointF(10, 10),
                        base::TimeTicks::Now(), flags, changed);
}

ui::ScrollEvent Scroll() {
  return ui::ScrollEvent(ui::EventType::kScroll, gfx::PointF(10, 10),
                         gfx::PointF(10, 10), base::TimeTicks::Now(),
                         ui::EF_NONE, 0, 12, 0, 12, 2);
}

ui::GestureEvent Pinch(ui::GestureDeviceType device) {
  ui::GestureEventDetails details(ui::EventType::kGesturePinchBegin);
  details.set_device_type(device);
  return ui::GestureEvent(10, 10, ui::EF_NONE, base::TimeTicks::Now(), details);
}

class PointerHidingTest : public testing::Test {
 protected:
  void Configure(std::optional<base::TimeDelta> after, bool when_typing) {
    hiding_.Configure(
        PointerHidingSettings{.after = after, .when_typing = when_typing});
  }

  base::test::SingleThreadTaskEnvironment task_environment_{
      base::test::TaskEnvironment::TimeSource::MOCK_TIME};
  RecordingPointer pointer_;
  PointerHiding hiding_{pointer_};
};

// Letters, digits, Enter and Shift+A are typing.
TEST_F(PointerHidingTest, ATypingKeyHidesThePointer) {
  Configure(std::nullopt, true);

  hiding_.Heard(Key(ui::VKEY_A, ui::EF_SHIFT_DOWN));
  EXPECT_EQ(pointer_.Take(), (Heard{"hide"}));

  hiding_.Heard(Mouse(ui::EventType::kMouseMoved));
  hiding_.Heard(Key(ui::VKEY_RETURN));
  EXPECT_EQ(pointer_.Take(), (Heard{"show", "hide"}));
}

// A held key repeating, Shift alone, a shortcut, a function or media key, and
// a key pressed during a drag are not typing.
TEST_F(PointerHidingTest, KeysThatAreNotTypingLeaveThePointer) {
  Configure(std::nullopt, true);

  hiding_.Heard(Key(ui::VKEY_A, ui::EF_IS_REPEAT));
  hiding_.Heard(Key(ui::VKEY_SHIFT, ui::EF_SHIFT_DOWN));
  hiding_.Heard(Key(ui::VKEY_C, ui::EF_CONTROL_DOWN));
  hiding_.Heard(Key(ui::VKEY_TAB, ui::EF_ALT_DOWN));
  hiding_.Heard(Key(ui::VKEY_RETURN, ui::EF_COMMAND_DOWN));
  hiding_.Heard(Key(ui::VKEY_F5));
  hiding_.Heard(Key(ui::VKEY_VOLUME_UP));
  hiding_.Heard(Key(ui::VKEY_BRIGHTNESS_DOWN));
  hiding_.Heard(Mouse(ui::EventType::kMousePressed, ui::EF_LEFT_MOUSE_BUTTON,
                      ui::EF_LEFT_MOUSE_BUTTON));
  hiding_.Heard(Key(ui::VKEY_A));

  EXPECT_TRUE(pointer_.Take().empty());
}

TEST_F(PointerHidingTest, TypingLeavesThePointerUnlessTheDeskSaysToHideIt) {
  Configure(std::nullopt, false);

  hiding_.Heard(Key(ui::VKEY_A));

  EXPECT_TRUE(pointer_.Take().empty());
}

// Two-finger scrolling and a touchpad pinch are the pointer in use; a move
// aura made up and a touchscreen pinch are not.
TEST_F(PointerHidingTest, PointerInputShowsThePointer) {
  Configure(std::nullopt, true);
  const auto shown_by = [&](const ui::Event& event) {
    hiding_.Heard(Key(ui::VKEY_A));
    pointer_.Take();
    hiding_.Heard(event);
    return pointer_.Take() == Heard{"show"};
  };

  EXPECT_TRUE(shown_by(Mouse(ui::EventType::kMouseMoved)));
  EXPECT_TRUE(shown_by(Scroll()));
  EXPECT_TRUE(shown_by(Pinch(ui::GestureDeviceType::DEVICE_TOUCHPAD)));
  EXPECT_FALSE(
      shown_by(Mouse(ui::EventType::kMouseMoved, ui::EF_IS_SYNTHESIZED)));
  EXPECT_FALSE(shown_by(Mouse(ui::EventType::kMouseMoved, ui::EF_FROM_TOUCH)));
  EXPECT_FALSE(shown_by(Pinch(ui::GestureDeviceType::DEVICE_TOUCHSCREEN)));
}

// A swipe of three or more fingers never reaches aura; DeskGestures says so.
TEST_F(PointerHidingTest, ATouchpadGestureShowsThePointer) {
  Configure(std::nullopt, true);
  hiding_.Heard(Key(ui::VKEY_A));
  pointer_.Take();

  hiding_.Touched();

  EXPECT_EQ(pointer_.Take(), (Heard{"show"}));
}

TEST_F(PointerHidingTest, ThePointerHidesAfterAPauseInPointerInput) {
  Configure(base::Seconds(1), false);
  hiding_.Heard(Mouse(ui::EventType::kMouseMoved));

  task_environment_.FastForwardBy(base::Milliseconds(900));
  hiding_.Heard(Mouse(ui::EventType::kMouseMoved));
  hiding_.Heard(Key(ui::VKEY_A));
  task_environment_.FastForwardBy(base::Milliseconds(900));
  EXPECT_TRUE(pointer_.Take().empty());

  task_environment_.FastForwardBy(base::Milliseconds(100));
  EXPECT_EQ(pointer_.Take(), (Heard{"hide"}));
}

// A drag held still is the pointer in use.
TEST_F(PointerHidingTest, ThePointerStaysWhileAButtonIsHeld) {
  Configure(base::Seconds(1), false);
  hiding_.Heard(Mouse(ui::EventType::kMousePressed, ui::EF_LEFT_MOUSE_BUTTON,
                      ui::EF_LEFT_MOUSE_BUTTON));

  task_environment_.FastForwardBy(base::Seconds(5));
  EXPECT_TRUE(pointer_.Take().empty());

  hiding_.Heard(Mouse(ui::EventType::kMouseReleased, ui::EF_LEFT_MOUSE_BUTTON,
                      ui::EF_LEFT_MOUSE_BUTTON));
  task_environment_.FastForwardBy(base::Seconds(1));
  EXPECT_EQ(pointer_.Take(), (Heard{"hide"}));
}

// A config reload that stops hiding the pointer shows it.
TEST_F(PointerHidingTest, SettingsThatNeverHideShowThePointer) {
  Configure(base::Seconds(1), false);
  task_environment_.FastForwardBy(base::Seconds(1));
  EXPECT_EQ(pointer_.Take(), (Heard{"hide"}));

  Configure(std::nullopt, false);
  task_environment_.FastForwardBy(base::Seconds(5));
  EXPECT_EQ(pointer_.Take(), (Heard{"show"}));
}

}  // namespace
}  // namespace domicile
