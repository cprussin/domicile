// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/typing_guard.h"

#include <linux/input-event-codes.h>

#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

base::TimeTicks At(int ms) {
  return base::TimeTicks() + base::Milliseconds(ms);
}

// Presses and releases `key` at `ms`.
void Type(TypingGuard& guard, unsigned int key, int ms) {
  guard.OnKey(key, /*down=*/true, At(ms));
  guard.OnKey(key, /*down=*/false, At(ms));
}

TEST(TypingGuardTest, OneKeyRestsThePadBriefly) {
  TypingGuard guard;
  Type(guard, KEY_A, 0);
  EXPECT_TRUE(guard.DropsMotion(At(199)));
  EXPECT_FALSE(guard.DropsMotion(At(200)));
}

TEST(TypingGuardTest, TypingRestsThePadLonger) {
  TypingGuard guard;
  Type(guard, KEY_A, 0);
  Type(guard, KEY_S, 100);
  EXPECT_TRUE(guard.DropsMotion(At(599)));
  EXPECT_FALSE(guard.DropsMotion(At(600)));
}

TEST(TypingGuardTest, KeysOutsideTheTypingRowsRestNothing) {
  TypingGuard guard;
  Type(guard, KEY_LEFTSHIFT, 0);
  Type(guard, KEY_F5, 0);
  Type(guard, KEY_VOLUMEUP, 0);
  EXPECT_FALSE(guard.DropsMotion(At(1)));
}

TEST(TypingGuardTest, AShortcutRestsNothing) {
  // Ctrl+C, then a click to paste somewhere.
  TypingGuard guard;
  guard.OnKey(KEY_LEFTCTRL, /*down=*/true, At(0));
  Type(guard, KEY_C, 10);
  EXPECT_FALSE(guard.DropsMotion(At(20)));

  guard.OnKey(KEY_LEFTCTRL, /*down=*/false, At(30));
  Type(guard, KEY_C, 40);
  EXPECT_TRUE(guard.DropsMotion(At(50)));
}

TEST(TypingGuardTest, ACapitalLetterIsTyping) {
  TypingGuard guard;
  guard.OnKey(KEY_LEFTSHIFT, /*down=*/true, At(0));
  Type(guard, KEY_A, 10);
  EXPECT_TRUE(guard.DropsMotion(At(20)));
}

TEST(TypingGuardTest, ATurnedOffGuardDropsNothing) {
  TypingGuard guard;
  guard.SetEnabled(false);
  EXPECT_FALSE(guard.enabled());
  Type(guard, KEY_A, 0);
  EXPECT_FALSE(guard.DropsMotion(At(1)));
  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, /*down=*/true, At(1)));
}

TEST(TypingGuardTest, ReenablingStartsWithNoStaleTypingPause) {
  TypingGuard guard;
  Type(guard, KEY_A, 0);
  EXPECT_TRUE(guard.DropsMotion(At(1)));
  guard.SetEnabled(false);
  guard.SetEnabled(true);
  EXPECT_FALSE(guard.DropsMotion(At(2)));
}

TEST(TypingGuardTest, ConfigurablePausesHonorBothBoundaries) {
  TypingGuard guard;
  guard.SetPauses(base::Milliseconds(50), base::Milliseconds(80));
  Type(guard, KEY_A, 0);
  EXPECT_TRUE(guard.DropsMotion(At(49)));
  Type(guard, KEY_S, 49);
  EXPECT_TRUE(guard.DropsMotion(At(128)));
  EXPECT_FALSE(guard.DropsMotion(At(129)));
  guard.SetPauses(base::Milliseconds(0), base::Milliseconds(0));
  Type(guard, KEY_A, 200);
  EXPECT_FALSE(guard.DropsMotion(At(200)));
}

TEST(TypingGuardTest, AZeroInitialPauseStillRecognizesContinuedTyping) {
  TypingGuard guard;
  guard.SetPauses(base::Milliseconds(0), base::Milliseconds(500));
  Type(guard, KEY_A, 0);
  EXPECT_FALSE(guard.DropsMotion(At(1)));
  Type(guard, KEY_S, 100);
  EXPECT_TRUE(guard.DropsMotion(At(599)));
  EXPECT_FALSE(guard.DropsMotion(At(600)));
  Type(guard, KEY_D, 800);
  EXPECT_FALSE(guard.DropsMotion(At(801)));
  guard.SetEnabled(false);
  guard.SetEnabled(true);
  Type(guard, KEY_F, 900);
  EXPECT_FALSE(guard.DropsMotion(At(901)));
}

TEST(TypingGuardTest, AZeroRepeatPauseEndsSuppressionDuringContinuedTyping) {
  TypingGuard guard;
  guard.SetPauses(base::Milliseconds(200), base::Milliseconds(0));
  Type(guard, KEY_A, 0);
  EXPECT_TRUE(guard.DropsMotion(At(1)));
  Type(guard, KEY_S, 100);
  EXPECT_FALSE(guard.DropsMotion(At(100)));
  Type(guard, KEY_D, 200);
  EXPECT_FALSE(guard.DropsMotion(At(200)));
  Type(guard, KEY_F, 400);
  EXPECT_TRUE(guard.DropsMotion(At(401)));
}

TEST(TypingGuardTest, ASettingsChangeKeepsButtonReleasePairing) {
  TypingGuard guard;
  Type(guard, KEY_A, 0);
  EXPECT_TRUE(guard.DropsButton(BTN_LEFT, true, At(1)));
  guard.SetEnabled(false);
  guard.SetPauses(base::Milliseconds(10), base::Milliseconds(20));
  EXPECT_TRUE(guard.DropsButton(BTN_LEFT, false, At(2)));
  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, true, At(3)));
  guard.SetEnabled(true);
  Type(guard, KEY_A, 4);
  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, false, At(5)));
}

TEST(TypingGuardTest, AnExternalPadDragDoesNotUnlockAnInternalPad) {
  TypingGuard guard;
  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, true, At(0), false, 2));
  Type(guard, KEY_A, 1);
  EXPECT_TRUE(guard.DropsMotion(At(2), 1));
  EXPECT_FALSE(guard.DropsMotion(At(2), 2));
  EXPECT_TRUE(guard.DropsButton(BTN_LEFT, true, At(3), true, 1));
  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, false, At(4), false, 2));
  EXPECT_TRUE(guard.DropsButton(BTN_LEFT, false, At(5), false, 1));
}

TEST(TypingGuardTest, DetachingClearsOnlyThatPadsPassedAndDroppedButtons) {
  TypingGuard guard;
  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, true, At(0), true, 1));
  EXPECT_FALSE(guard.DropsButton(BTN_RIGHT, true, At(0), true, 2));
  Type(guard, KEY_A, 1);
  EXPECT_TRUE(guard.DropsButton(BTN_MIDDLE, true, At(2), true, 1));
  EXPECT_TRUE(guard.DropsButton(BTN_LEFT, true, At(2), true, 2));
  guard.RemoveDevice(1);
  EXPECT_TRUE(guard.DropsMotion(At(3), 1));
  EXPECT_FALSE(guard.DropsMotion(At(3), 2));
  EXPECT_FALSE(guard.DropsButton(BTN_MIDDLE, false, At(4), false, 1));
  EXPECT_TRUE(guard.DropsButton(BTN_LEFT, false, At(4), false, 2));
  EXPECT_FALSE(guard.DropsButton(BTN_RIGHT, false, At(4), false, 2));
  EXPECT_TRUE(guard.DropsMotion(At(5), 2));
}

TEST(TypingGuardTest, AReleaseGoesTheWayItsPressWent) {
  // A tap while typing is dropped whole, and a click held from before typing
  // is released, so no button is left down.
  TypingGuard guard;
  Type(guard, KEY_A, 0);
  EXPECT_TRUE(guard.DropsButton(BTN_LEFT, /*down=*/true, At(50)));
  EXPECT_TRUE(guard.DropsButton(BTN_LEFT, /*down=*/false, At(300)));

  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, /*down=*/true, At(400)));
  Type(guard, KEY_A, 410);
  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, /*down=*/false, At(420)));
}

TEST(TypingGuardTest, AHeldButtonKeepsThePadMoving) {
  // A key pressed partway through a drag.
  TypingGuard guard;
  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, /*down=*/true, At(0)));
  Type(guard, KEY_A, 10);
  EXPECT_FALSE(guard.DropsMotion(At(20)));

  EXPECT_FALSE(guard.DropsButton(BTN_LEFT, /*down=*/false, At(30)));
  EXPECT_TRUE(guard.DropsMotion(At(40)));
}

}  // namespace
}  // namespace ui
