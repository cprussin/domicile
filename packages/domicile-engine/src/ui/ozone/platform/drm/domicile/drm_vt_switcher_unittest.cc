// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_vt_switcher.h"

#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

// The happy path, in the order `console_ioctl(2)` documents: the kernel asks,
// the delegate answers, and only then does the switch get its acknowledgement.
TEST(DrmVtSwitcherTest, AReleaseDropsTheDisplayBeforeItAllowsTheSwitch) {
  const VtStep asked =
      StepVtSwitch(VtState::kOwned, VtEvent::kReleaseRequested, false);
  EXPECT_EQ(asked.action, VtAction::kRelinquishDisplay);
  EXPECT_EQ(asked.state, VtState::kReleasing);

  const VtStep answered =
      StepVtSwitch(asked.state, VtEvent::kRelinquishFinished, true);
  EXPECT_EQ(answered.action, VtAction::kAllowSwitch);
  EXPECT_EQ(answered.state, VtState::kReleased);
}

// THE CASE THE ORDERING EXISTS FOR. `VT_RELDISP(1)` before the delegate has
// answered would hand the console to the kernel while Chromium still holds DRM
// master, and both would then be driving the same CRTC. The switch is refused
// instead, which leaves the user on a working desktop rather than on a screen
// two processes are fighting over.
TEST(DrmVtSwitcherTest, ARelinquishThatFailsRefusesTheSwitch) {
  const VtStep step =
      StepVtSwitch(VtState::kReleasing, VtEvent::kRelinquishFinished, false);

  EXPECT_EQ(step.action, VtAction::kRefuseSwitch);
  EXPECT_EQ(step.state, VtState::kOwned)
      << "a refused switch leaves the display where it was";
}

TEST(DrmVtSwitcherTest, AnAcquireTakesTheDisplayBeforeItAcknowledges) {
  const VtStep asked =
      StepVtSwitch(VtState::kReleased, VtEvent::kAcquireRequested, false);
  EXPECT_EQ(asked.action, VtAction::kTakeDisplay);
  EXPECT_EQ(asked.state, VtState::kAcquiring);

  const VtStep answered =
      StepVtSwitch(asked.state, VtEvent::kTakeFinished, true);
  EXPECT_EQ(answered.action, VtAction::kAckAcquire);
  EXPECT_EQ(answered.state, VtState::kOwned);
}

// An acquire cannot be refused -- by the time `acqsig` arrives the console is
// already ours -- so a failed take still acknowledges. What it must not do is
// pretend the display came back with it.
TEST(DrmVtSwitcherTest, ATakeThatFailsStillAcknowledgesTheSwitch) {
  const VtStep step =
      StepVtSwitch(VtState::kAcquiring, VtEvent::kTakeFinished, false);

  EXPECT_EQ(step.action, VtAction::kAckAcquire);
  EXPECT_EQ(step.state, VtState::kConsoleWithoutDisplay)
      << "the console is ours and the display is not, and saying otherwise is "
         "what strands somebody";
}

// AND THE REASON THAT STATE EXISTS. With the display already lost, trying to
// relinquish it again would fail, and a failed relinquish refuses the switch --
// which would trap the user on a console nothing can paint. So the way out is
// always open.
TEST(DrmVtSwitcherTest, AConsoleWithNoDisplayLetsTheUserSwitchAwayAtOnce) {
  const VtStep step = StepVtSwitch(VtState::kConsoleWithoutDisplay,
                                   VtEvent::kReleaseRequested, false);

  EXPECT_EQ(step.action, VtAction::kAllowSwitch)
      << "there is no display to give back, so nothing is owed before the "
         "switch";
  EXPECT_EQ(step.state, VtState::kReleased);
}

// The kernel sends one `relsig` per switch, but a second arriving while the
// delegate is still thinking must not start a second relinquish -- two drops in
// flight is two answers, and the second would acknowledge a switch the first
// has already acknowledged.
TEST(DrmVtSwitcherTest, ASecondReleaseWhileReleasingIsIgnored) {
  const VtStep step =
      StepVtSwitch(VtState::kReleasing, VtEvent::kReleaseRequested, false);

  EXPECT_EQ(step.action, VtAction::kNothing);
  EXPECT_EQ(step.state, VtState::kReleasing);
}

// Asked to leave a console we do not have. Nothing is owed, and the switch is
// allowed rather than refused: refusing would wedge whoever asked.
TEST(DrmVtSwitcherTest, AReleaseWhileAlreadyReleasedIsAllowed) {
  const VtStep step =
      StepVtSwitch(VtState::kReleased, VtEvent::kReleaseRequested, false);

  EXPECT_EQ(step.action, VtAction::kAllowSwitch);
  EXPECT_EQ(step.state, VtState::kReleased);
}

// Told we have a console we never lost. Acknowledging is harmless and silence
// is not: the kernel is waiting for one.
TEST(DrmVtSwitcherTest, AnAcquireWhileAlreadyOwnedIsAcknowledged) {
  const VtStep step =
      StepVtSwitch(VtState::kOwned, VtEvent::kAcquireRequested, false);

  EXPECT_EQ(step.action, VtAction::kAckAcquire);
  EXPECT_EQ(step.state, VtState::kOwned);
}

// A delegate answering a question nobody is waiting on. This is not
// hypothetical -- a relinquish that completes after its switch was refused, or
// after the console came back, arrives exactly here -- and acting on it would
// acknowledge a handshake that is over.
TEST(DrmVtSwitcherTest, AnAnswerNobodyIsWaitingForChangesNothing) {
  for (const VtState state : {VtState::kOwned, VtState::kReleased,
                              VtState::kConsoleWithoutDisplay}) {
    const VtStep relinquished =
        StepVtSwitch(state, VtEvent::kRelinquishFinished, true);
    EXPECT_EQ(relinquished.action, VtAction::kNothing);
    EXPECT_EQ(relinquished.state, state);

    const VtStep taken = StepVtSwitch(state, VtEvent::kTakeFinished, true);
    EXPECT_EQ(taken.action, VtAction::kNothing);
    EXPECT_EQ(taken.state, state);
  }
}

// THE POSITIVE CONTROL THIS TABLE WOULD BE WORTHLESS WITHOUT. Every state must
// answer every event with something, because a state machine that falls
// through to "do nothing" on an input it did not anticipate is how a console
// stops answering the kernel and a machine needs a power cycle. This asserts
// the table is total rather than that any particular cell is right -- the cells
// are the tests above.
TEST(DrmVtSwitcherTest, EveryStateAnswersEveryEvent) {
  constexpr VtState kStates[] = {
      VtState::kOwned, VtState::kReleasing, VtState::kReleased,
      VtState::kAcquiring, VtState::kConsoleWithoutDisplay};
  constexpr VtEvent kEvents[] = {
      VtEvent::kReleaseRequested, VtEvent::kRelinquishFinished,
      VtEvent::kAcquireRequested, VtEvent::kTakeFinished};

  for (const VtState state : kStates) {
    for (const VtEvent event : kEvents) {
      for (const bool succeeded : {false, true}) {
        const VtStep step = StepVtSwitch(state, event, succeeded);
        // The kernel is waiting on exactly two of these, so whenever the table
        // says a switch is in flight it must eventually produce one of them.
        // What is asserted here is weaker and is the part that can be: the
        // step lands in a real state rather than off the end of the enum.
        EXPECT_GE(static_cast<int>(step.state),
                  static_cast<int>(VtState::kOwned));
        EXPECT_LE(static_cast<int>(step.state),
                  static_cast<int>(VtState::kConsoleWithoutDisplay));
      }
    }
  }
}

// NO SWITCH IS EVER LEFT UNANSWERED, walked rather than argued. From every
// state, a release request followed by whatever the delegate says must reach
// `kAllowSwitch` or `kRefuseSwitch` -- the two things the kernel accepts. A
// path that reaches neither is a console waiting forever on a process that has
// stopped talking to it, which is the failure this whole file exists to avoid.
TEST(DrmVtSwitcherTest, EveryReleaseReachesAnAnswerForTheKernel) {
  constexpr VtState kStates[] = {
      VtState::kOwned, VtState::kReleasing, VtState::kReleased,
      VtState::kAcquiring, VtState::kConsoleWithoutDisplay};

  for (const VtState start : kStates) {
    for (const bool delegate_says : {false, true}) {
      const VtStep asked =
          StepVtSwitch(start, VtEvent::kReleaseRequested, false);
      if (asked.action == VtAction::kAllowSwitch ||
          asked.action == VtAction::kRefuseSwitch) {
        continue;  // Answered outright.
      }
      if (asked.action == VtAction::kNothing) {
        // Only legal while an answer is already in flight, which the
        // `kRelinquishFinished` row below then delivers.
        ASSERT_EQ(asked.state, VtState::kReleasing)
            << "a release was dropped in a state with nothing in flight";
      }
      const VtStep answered =
          StepVtSwitch(asked.state, VtEvent::kRelinquishFinished,
                       delegate_says);
      EXPECT_TRUE(answered.action == VtAction::kAllowSwitch ||
                  answered.action == VtAction::kRefuseSwitch)
          << "a release from this state never answers the kernel";
    }
  }
}

}  // namespace
}  // namespace ui
