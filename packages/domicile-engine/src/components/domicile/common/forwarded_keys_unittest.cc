// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/forwarded_keys.h"

#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Evdev keycodes.
constexpr uint32_t kA = 30;
constexpr uint32_t kFive = 6;

TEST(ForwardedKeysTest, AForwardedKeyComesUpForItsWindow) {
  ForwardedKeys<std::string> keys;
  keys.Forward(kA, "term");

  EXPECT_FALSE(keys.TakenUp(kA));
  EXPECT_EQ(keys.HeldUp(kA), std::optional<std::string>("term"));
  EXPECT_EQ(keys.HeldUp(kA), std::nullopt) << "released once";
}

TEST(ForwardedKeysTest, ATakenKeyComesUpTaken) {
  ForwardedKeys<std::string> keys;
  keys.Take(kA);

  EXPECT_TRUE(keys.TakenUp(kA));
  EXPECT_FALSE(keys.TakenUp(kA)) << "taken once";
}

// Super+( taken, its release heard by the guest it focused: the next ( sent
// to a window must still come up there, or the window repeats it for good.
TEST(ForwardedKeysTest, AForwardedPressEndsATakenOneWhoseReleaseWasLost) {
  ForwardedKeys<std::string> keys;
  keys.Take(kFive);
  keys.Forward(kFive, "term");

  EXPECT_FALSE(keys.TakenUp(kFive));
  EXPECT_EQ(keys.HeldUp(kFive), std::optional<std::string>("term"));
}

// ( held in a window, then Super: the repeats are Super+( and taken, but the
// release is the window's.
TEST(ForwardedKeysTest, AKeyHeldForAWindowIsNotTaken) {
  ForwardedKeys<std::string> keys;
  keys.Forward(kFive, "term");
  keys.Take(kFive);

  EXPECT_FALSE(keys.TakenUp(kFive));
  EXPECT_EQ(keys.HeldUp(kFive), std::optional<std::string>("term"));
}

TEST(ForwardedKeysTest, LettingGoOfEveryHeldKeyEmptiesThem) {
  ForwardedKeys<std::string> keys;
  keys.Forward(kA, "term");
  keys.Forward(kFive, "editor");

  EXPECT_EQ(keys.TakeHeld(), (std::vector<std::pair<uint32_t, std::string>>{
                                 {kFive, "editor"}, {kA, "term"}}));
  EXPECT_EQ(keys.HeldUp(kA), std::nullopt);
}

}  // namespace
}  // namespace domicile
