// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_vt_switcher.h"

#include <memory>
#include <string>

#include "dbus/message.h"
#include "dbus/object_path.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/keyboard_codes_posix.h"
#include "ui/events/types/event_type.h"

namespace ui {
namespace {

KeyEvent Pressed(KeyboardCode key, int flags) {
  return KeyEvent(EventType::kKeyPressed, key, flags);
}

constexpr int kChord = EF_CONTROL_DOWN | EF_ALT_DOWN;

// Builds logind's reply to a `Get` of `Session.Seat`: a variant holding `(so)`.
std::unique_ptr<dbus::Response> SeatAnswer(const std::string& id,
                                           const std::string& path) {
  std::unique_ptr<dbus::Response> answer = dbus::Response::CreateEmpty();
  dbus::MessageWriter writer(answer.get());
  dbus::MessageWriter variant(nullptr);
  writer.OpenVariant("(so)", &variant);
  dbus::MessageWriter seat(nullptr);
  variant.OpenStruct(&seat);
  seat.AppendString(id);
  seat.AppendObjectPath(dbus::ObjectPath(path));
  variant.CloseContainer(&seat);
  writer.CloseContainer(&variant);
  return answer;
}

// F<n> maps to console n, the number `Seat.SwitchTo` takes.
TEST(DrmVtSwitcherTest, EveryFunctionKeyNamesItsOwnConsole) {
  for (uint32_t vt = 1; vt <= 12; vt++) {
    const KeyboardCode key = static_cast<KeyboardCode>(VKEY_F1 + vt - 1);
    const std::optional<uint32_t> named = VtForChord(Pressed(key, kChord));
    ASSERT_TRUE(named.has_value());
    EXPECT_EQ(*named, vt);
  }
}

// Switching on release too would request the same console twice.
TEST(DrmVtSwitcherTest, AReleaseIsNotASwitch) {
  const KeyEvent released(EventType::kKeyReleased, VKEY_F3, kChord);

  EXPECT_FALSE(VtForChord(released).has_value());
}

// Alt+F4 and Ctrl+F5 are ordinary shortcuts; both modifiers are required.
TEST(DrmVtSwitcherTest, HalfTheChordIsNotTheChord) {
  EXPECT_FALSE(VtForChord(Pressed(VKEY_F4, EF_ALT_DOWN)).has_value());
  EXPECT_FALSE(VtForChord(Pressed(VKEY_F5, EF_CONTROL_DOWN)).has_value());
  EXPECT_FALSE(VtForChord(Pressed(VKEY_F2, EF_NONE)).has_value());
}

// Extra modifiers leave the chord free for shells, e.g. Ctrl+Alt+Shift+F1.
TEST(DrmVtSwitcherTest, AnExtraModifierIsSomebodyElsesShortcut) {
  for (const int extra : {EF_SHIFT_DOWN, EF_COMMAND_DOWN, EF_ALTGR_DOWN}) {
    EXPECT_FALSE(VtForChord(Pressed(VKEY_F1, kChord | extra)).has_value());
  }
}

TEST(DrmVtSwitcherTest, AKeyThatIsNotAFunctionKeyNamesNoConsole) {
  EXPECT_FALSE(VtForChord(Pressed(VKEY_A, kChord)).has_value());
  EXPECT_FALSE(VtForChord(Pressed(VKEY_F13, kChord)).has_value());
  EXPECT_FALSE(VtForChord(Pressed(VKEY_DELETE, kChord)).has_value());
}

// Deactivation drops the display.
TEST(DrmVtSwitcherTest, ASessionGoingAwayDropsTheDisplay) {
  const VtStep told =
      StepVtSwitch(VtState::kForeground, VtEvent::kSessionDeactivated, false);
  EXPECT_EQ(told.action, VtAction::kRelinquishDisplay);
  EXPECT_EQ(told.state, VtState::kRelinquishing);

  const VtStep answered =
      StepVtSwitch(told.state, VtEvent::kRelinquishFinished, true);
  EXPECT_EQ(answered.action, VtAction::kNothing);
  EXPECT_EQ(answered.state, VtState::kBackground);
}

// Activation takes the display back, then relights it because another console
// reprogrammed the CRTCs. See `VtAction::kRelightDisplay`.
TEST(DrmVtSwitcherTest, ASessionComingBackTakesTheDisplayAndLightsIt) {
  const VtStep told =
      StepVtSwitch(VtState::kBackground, VtEvent::kSessionActivated, false);
  EXPECT_EQ(told.action, VtAction::kTakeDisplay);
  EXPECT_EQ(told.state, VtState::kTaking);

  const VtStep answered =
      StepVtSwitch(told.state, VtEvent::kTakeFinished, true);
  EXPECT_EQ(answered.action, VtAction::kRelightDisplay);
  EXPECT_EQ(answered.state, VtState::kForeground);
}

// Only a successful take relights. A relight elsewhere would commit over
// another console's frame or modeset repeatedly.
TEST(DrmVtSwitcherTest, NothingButTheConsoleComingBackLightsTheScreens) {
  constexpr VtState kStates[] = {
      VtState::kForeground, VtState::kRelinquishing, VtState::kBackground,
      VtState::kTaking, VtState::kForegroundWithoutDisplay};
  constexpr VtEvent kEvents[] = {
      VtEvent::kSessionDeactivated, VtEvent::kRelinquishFinished,
      VtEvent::kSessionActivated, VtEvent::kTakeFinished};

  for (const VtState state : kStates) {
    for (const VtEvent event : kEvents) {
      for (const bool succeeded : {false, true}) {
        const bool came_back = state == VtState::kTaking &&
                               event == VtEvent::kTakeFinished && succeeded;
        if (!came_back) {
          EXPECT_NE(StepVtSwitch(state, event, succeeded).action,
                    VtAction::kRelightDisplay);
        }
      }
    }
  }
}

// logind switches regardless of the drop's result, so a failed drop still
// ends in the background. The next take recovers.
TEST(DrmVtSwitcherTest, ARelinquishCannotRefuseTheSwitch) {
  for (const bool succeeded : {false, true}) {
    const VtStep step = StepVtSwitch(VtState::kRelinquishing,
                                     VtEvent::kRelinquishFinished, succeeded);
    EXPECT_EQ(step.action, VtAction::kNothing);
    EXPECT_EQ(step.state, VtState::kBackground);
  }
}

// A failed take skips the next drop, which could only fail, and retries on the
// next activation.
TEST(DrmVtSwitcherTest, ATakeThatFailsLeavesTheDisplayToBeTakenAgain) {
  const VtStep failed =
      StepVtSwitch(VtState::kTaking, VtEvent::kTakeFinished, false);
  EXPECT_EQ(failed.action, VtAction::kNothing);
  EXPECT_EQ(failed.state, VtState::kForegroundWithoutDisplay);

  const VtStep left = StepVtSwitch(failed.state, VtEvent::kSessionDeactivated,
                                   false);
  EXPECT_EQ(left.action, VtAction::kNothing)
      << "there is no display to give back, so nothing is asked for";
  EXPECT_EQ(left.state, VtState::kBackground);

  const VtStep again =
      StepVtSwitch(failed.state, VtEvent::kSessionActivated, false);
  EXPECT_EQ(again.action, VtAction::kTakeDisplay);
}

// Switching away and straight back flips `Active` twice before the delegate
// answers. A drop that finishes after the session returned takes it back.
TEST(DrmVtSwitcherTest, ARelinquishThatLandsAfterTheSessionReturnedTakesItBack) {
  const VtStep returned = StepVtSwitch(VtState::kRelinquishing,
                                       VtEvent::kSessionActivated, false);
  EXPECT_EQ(returned.action, VtAction::kNothing)
      << "a drop is already in flight; asking for the display now would race it";
  EXPECT_EQ(returned.state, VtState::kForeground);

  const VtStep dropped =
      StepVtSwitch(returned.state, VtEvent::kRelinquishFinished, true);
  EXPECT_EQ(dropped.action, VtAction::kTakeDisplay);
  EXPECT_EQ(dropped.state, VtState::kTaking);
}

// A take that finishes after the session left gives master straight back, so
// this process never holds it on another console.
TEST(DrmVtSwitcherTest, ATakeThatLandsAfterTheSessionLeftGivesItStraightBack) {
  const VtStep left =
      StepVtSwitch(VtState::kTaking, VtEvent::kSessionDeactivated, false);
  EXPECT_EQ(left.action, VtAction::kNothing);
  EXPECT_EQ(left.state, VtState::kBackground);

  const VtStep taken =
      StepVtSwitch(left.state, VtEvent::kTakeFinished, true);
  EXPECT_EQ(taken.action, VtAction::kRelinquishDisplay);
  EXPECT_EQ(taken.state, VtState::kRelinquishing);

  const VtStep never = StepVtSwitch(left.state, VtEvent::kTakeFinished, false);
  EXPECT_EQ(never.action, VtAction::kNothing)
      << "a take that failed left nothing to give back";
  EXPECT_EQ(never.state, VtState::kBackground);
}

// Every `PropertiesChanged` rereads `Active`, so repeats must be no-ops.
TEST(DrmVtSwitcherTest, BeingToldTheSameThingTwiceAsksForNothing) {
  const VtStep again = StepVtSwitch(VtState::kRelinquishing,
                                    VtEvent::kSessionDeactivated, false);
  EXPECT_EQ(again.action, VtAction::kNothing);
  EXPECT_EQ(again.state, VtState::kRelinquishing);

  for (const VtState settled : {VtState::kForeground, VtState::kBackground}) {
    const VtEvent same = settled == VtState::kForeground
                             ? VtEvent::kSessionActivated
                             : VtEvent::kSessionDeactivated;
    const VtStep step = StepVtSwitch(settled, same, false);
    EXPECT_EQ(step.action, VtAction::kNothing);
    EXPECT_EQ(step.state, settled);
  }
}

// A delegate answer for a superseded request is ignored.
TEST(DrmVtSwitcherTest, AnAnswerNobodyIsWaitingForChangesNothing) {
  for (const VtState state :
       {VtState::kBackground, VtState::kForegroundWithoutDisplay}) {
    const VtStep relinquished =
        StepVtSwitch(state, VtEvent::kRelinquishFinished, true);
    EXPECT_EQ(relinquished.action, VtAction::kNothing);
    EXPECT_EQ(relinquished.state, state);
  }

  for (const VtState state :
       {VtState::kForeground, VtState::kForegroundWithoutDisplay,
        VtState::kRelinquishing}) {
    const VtStep taken = StepVtSwitch(state, VtEvent::kTakeFinished, true);
    EXPECT_EQ(taken.action, VtAction::kNothing);
    EXPECT_EQ(taken.state, state);
  }
}

// Every (state, event) pair yields a valid state. Individual cells are tested
// above.
TEST(DrmVtSwitcherTest, EveryStateAnswersEveryEvent) {
  constexpr VtState kStates[] = {
      VtState::kForeground, VtState::kRelinquishing, VtState::kBackground,
      VtState::kTaking, VtState::kForegroundWithoutDisplay};
  constexpr VtEvent kEvents[] = {
      VtEvent::kSessionDeactivated, VtEvent::kRelinquishFinished,
      VtEvent::kSessionActivated, VtEvent::kTakeFinished};

  for (const VtState state : kStates) {
    for (const VtEvent event : kEvents) {
      for (const bool succeeded : {false, true}) {
        const VtStep step = StepVtSwitch(state, event, succeeded);
        EXPECT_GE(static_cast<int>(step.state),
                  static_cast<int>(VtState::kForeground));
        EXPECT_LE(static_cast<int>(step.state),
                  static_cast<int>(VtState::kForegroundWithoutDisplay));
      }
    }
  }
}

// From any state, a deactivation and the delegate's answer never settle in a
// foreground state, which would scan out over another console.
TEST(DrmVtSwitcherTest, NoPathLeavesTheDisplayHeldInTheBackground) {
  constexpr VtState kStates[] = {
      VtState::kForeground, VtState::kRelinquishing, VtState::kBackground,
      VtState::kTaking, VtState::kForegroundWithoutDisplay};

  for (const VtState start : kStates) {
    for (const bool delegate_says : {false, true}) {
      const VtStep told =
          StepVtSwitch(start, VtEvent::kSessionDeactivated, false);
      EXPECT_NE(told.state, VtState::kForeground)
          << "a deactivation left the session believing it is in front";
      EXPECT_NE(told.state, VtState::kForegroundWithoutDisplay);

      const VtEvent settles = told.state == VtState::kRelinquishing
                                  ? VtEvent::kRelinquishFinished
                                  : VtEvent::kTakeFinished;
      const VtStep settled =
          StepVtSwitch(told.state, settles, delegate_says);
      EXPECT_NE(settled.state, VtState::kForeground)
          << "the delegate's answer put the display back in the foreground";
      EXPECT_NE(settled.state, VtState::kForegroundWithoutDisplay);
    }
  }
}

// The seat comes from the session, not `seat/self` (which logind rejects on a
// real tty) or a hardcoded `seat0`.
TEST(DrmVtSwitcherTest, TheSeatIsWhicheverOneTheSessionIsOn) {
  for (const std::string id : {"seat0", "seat1"}) {
    const std::string path = "/org/freedesktop/login1/seat/" + id;
    const std::unique_ptr<dbus::Response> answer = SeatAnswer(id, path);
    dbus::MessageReader reader(answer.get());

    const std::optional<dbus::ObjectPath> seat = SeatOfSession(&reader);
    ASSERT_TRUE(seat.has_value());
    EXPECT_EQ(seat->value(), path);
  }
}

// logind reports "no seat" as the valid object path `/`, which is rejected.
TEST(DrmVtSwitcherTest, ASessionOnNoSeatNamesNoSeat) {
  const std::unique_ptr<dbus::Response> answer = SeatAnswer("", "/");
  dbus::MessageReader reader(answer.get());

  EXPECT_FALSE(SeatOfSession(&reader).has_value());
}

}  // namespace
}  // namespace ui
