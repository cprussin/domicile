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
