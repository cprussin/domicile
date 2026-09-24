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

// What logind answers a `Get` of the session's `Seat` with: the seat's id and
// its object path, as a `(so)` inside the variant every property comes in.
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

// The whole of what a user does: one chord per console, and the number on the
// key is the number of the console. `Seat.SwitchTo` takes that number, so
// there is nothing between this and logind.
TEST(DrmVtSwitcherTest, EveryFunctionKeyNamesItsOwnConsole) {
  for (uint32_t vt = 1; vt <= 12; vt++) {
    const KeyboardCode key = static_cast<KeyboardCode>(VKEY_F1 + vt - 1);
    const std::optional<uint32_t> named = VtForChord(Pressed(key, kChord));
    ASSERT_TRUE(named.has_value());
    EXPECT_EQ(*named, vt);
  }
}

// A chord is a press. Switching on the release as well would ask logind for
// the same console twice, and a release arriving after the switch is one this
// session no longer has the device to see.
TEST(DrmVtSwitcherTest, AReleaseIsNotASwitch) {
  const KeyEvent released(EventType::kKeyReleased, VKEY_F3, kChord);

  EXPECT_FALSE(VtForChord(released).has_value());
}

// Alt+F4 closes a window and Ctrl+F5 reloads a page. Both halves of the chord
// are what makes it a console switch rather than somebody's shortcut.
TEST(DrmVtSwitcherTest, HalfTheChordIsNotTheChord) {
  EXPECT_FALSE(VtForChord(Pressed(VKEY_F4, EF_ALT_DOWN)).has_value());
  EXPECT_FALSE(VtForChord(Pressed(VKEY_F5, EF_CONTROL_DOWN)).has_value());
  EXPECT_FALSE(VtForChord(Pressed(VKEY_F2, EF_NONE)).has_value());
}

// AND MORE THAN THE CHORD IS NOT THE CHORD EITHER, which is the half that
// would be a bug rather than a papercut: a shell that grabs Ctrl+Alt+Shift+F1
// would find the console switching out from under it. `Ctrl+Alt+F<n>` means
// exactly those two modifiers.
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

// The happy path away: logind says the session is no longer in front of the
// user, the display goes back, and that is the whole handshake this end has.
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

// THE HAPPY PATH BACK, AND TAKING THE DISPLAY IS ONLY HALF OF IT. Master says
// who may program the card and nothing about what the card is programmed to:
// whoever had the panel in between programmed it, so what this session
// resumes with is controller state describing hardware that has moved. The
// screens are lit again rather than flipped into, which is what
// `VtAction::kRelightDisplay` argues in full.
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

// AND EXACTLY ONE CELL ASKS FOR IT, which is the half a relight can get
// wrong. A modeset is a commit on the card: asked for anywhere this session
// does not hold the console it is a commit over somebody else's frame, and
// asked for on an edge that repeats it is the modeset loop this driver
// already had once. Only the take that succeeded lights anything.
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

// THE DIFFERENCE BETWEEN THIS TABLE AND THE ONE IT REPLACES, in one case. A
// switch used to be refusable: `VT_RELDISP(0)` told the kernel to leave the
// console where it was, and a relinquish that failed said exactly that. logind
// owns the handshake now and hands the console over on its own schedule, so
// there is nothing to refuse -- a drop that failed leaves a display nobody can
// paint on and a session that is in the background regardless, and the only
// way out is the take on the way back.
TEST(DrmVtSwitcherTest, ARelinquishCannotRefuseTheSwitch) {
  for (const bool succeeded : {false, true}) {
    const VtStep step = StepVtSwitch(VtState::kRelinquishing,
                                     VtEvent::kRelinquishFinished, succeeded);
    EXPECT_EQ(step.action, VtAction::kNothing);
    EXPECT_EQ(step.state, VtState::kBackground);
  }
}

// A take that fails must not say the display came back with the session: the
// next thing that happens is a deactivation, and relinquishing a display we do
// not have is a round trip that can only fail. What the state does carry is
// that another activation should try again.
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

// THE FIRST OF THE TWO RACES, AND THEY ARE REAL. A console switched away from
// and straight back to answers `PropertiesChanged` twice before the display
// delegate has answered once. A drop that lands after the session returned
// leaves the desktop in front of the user with no display, so it asks for it
// back rather than believing the state it started in.
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

// THE MIRROR, and the one that matters more: a take that lands after the
// session left would leave this process holding DRM master on a console
// somebody else is looking at, which is the two-owner bug the whole file
// exists to remove.
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

// logind emits `PropertiesChanged` for every property a session has, and this
// end answers all of them by reading `Active` -- so the same answer arrives
// repeatedly and only the edges may act.
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

// A delegate answering a question nobody is waiting on. Acting on it would
// take or drop a display on the strength of a round trip that has already been
// superseded.
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

// THE POSITIVE CONTROL THIS TABLE WOULD BE WORTHLESS WITHOUT. A state machine
// that falls off the end of its enum on an input it did not anticipate is how
// a desktop ends up holding DRM master forever. This asserts the table is
// total rather than that any particular cell is right -- the cells are the
// tests above.
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

// NO DISPLAY IS EVER HELD IN THE BACKGROUND, walked rather than argued. From
// every state, a deactivation followed by whatever the delegate says must end
// somewhere that is either done with the display or on its way to being: a
// path that settles in `kForeground` is this process scanning out over
// somebody else's console.
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

// THE ONE THE CHORD WAS SHIPPED BROKEN ON. `SwitchTo` went to
// `/org/freedesktop/login1/seat/self` and logind answered `UnknownObject` on a
// real tty: `self` is not a name it stores, it is a lookup through the
// caller's own bus credentials, and `seat_object_find` answers "no such
// object" for every way that lookup can come up empty. The session object
// `GetSessionByPID` already handed over carries the seat it is on, and reading
// that needs nobody's credentials -- nor a `seat0` spelled out here, which is
// the wrong seat on the second seat of a machine that has two.
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

// `/` IS logind's WORD FOR "NO SEAT", and it is a perfectly well-formed object
// path -- so a `SwitchTo` sent there fails exactly as cryptically as the alias
// did, and nothing between here and the panel would catch it. A session on no
// seat has no console to switch to at all, which is a thing to say out loud
// rather than a round trip to watch fail.
TEST(DrmVtSwitcherTest, ASessionOnNoSeatNamesNoSeat) {
  const std::unique_ptr<dbus::Response> answer = SeatAnswer("", "/");
  dbus::MessageReader reader(answer.get());

  EXPECT_FALSE(SeatOfSession(&reader).has_value());
}

}  // namespace
}  // namespace ui
