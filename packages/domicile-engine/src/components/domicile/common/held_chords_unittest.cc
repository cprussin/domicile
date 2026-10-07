// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/held_chords.h"

#include <cstdint>
#include <vector>

#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

struct Press {
  uint32_t keycode = 0;
  bool alt = false;
  bool ctrl = false;
  bool shift = false;
  bool meta = false;

  friend bool operator==(const Press&, const Press&) = default;
};

// Evdev keycodes.
constexpr uint32_t kA = 30;
constexpr uint32_t kB = 48;
constexpr uint32_t kLeftShift = 42;
constexpr uint32_t kLeftMeta = 125;

Press Meta(uint32_t keycode) {
  return Press{keycode, /*alt=*/false, /*ctrl=*/false, /*shift=*/false,
               /*meta=*/true};
}

// A key coming up with Meta still held, or with nothing held.
Press UpHoldingMeta(uint32_t keycode) {
  return Meta(keycode);
}
Press UpHoldingNothing(uint32_t keycode) {
  return Press{keycode};
}

std::vector<Press> Released(HeldChords<Press>& held, const Press& up) {
  std::vector<Press> released;
  held.Release(up, [&released](const Press& press) {
    released.push_back(press);
  });
  return released;
}

TEST(HeldChordsTest, AChordIsReleasedWhenItsKeyComesUp) {
  HeldChords<Press> held;
  held.Press(Meta(kA));

  EXPECT_EQ(Released(held, UpHoldingMeta(kA)), std::vector{Meta(kA)});
  EXPECT_EQ(Released(held, UpHoldingMeta(kA)), std::vector<Press>{})
      << "released once";
}

// Meta+Shift+l let go of Shift is no longer Meta+Shift+l, though l is down.
TEST(HeldChordsTest, AChordIsReleasedWhenOneOfItsModifiersComesUp) {
  HeldChords<Press> held;
  const Press chord{kA, /*alt=*/false, /*ctrl=*/false, /*shift=*/true,
                    /*meta=*/true};
  held.Press(chord);

  EXPECT_EQ(Released(held, UpHoldingMeta(kLeftShift)), std::vector{chord});
}

TEST(HeldChordsTest, AnotherKeyComingUpReleasesNothing) {
  HeldChords<Press> held;
  held.Press(Meta(kA));

  EXPECT_EQ(Released(held, UpHoldingMeta(kB)), std::vector<Press>{});
  EXPECT_EQ(Released(held, UpHoldingMeta(kA)), std::vector{Meta(kA)});
}

TEST(HeldChordsTest, TwoHeldChordsAreReleasedOnTheirOwnInEitherOrder) {
  HeldChords<Press> held;
  held.Press(Meta(kA));
  held.Press(Meta(kB));
  EXPECT_EQ(Released(held, UpHoldingMeta(kB)), std::vector{Meta(kB)});
  EXPECT_EQ(Released(held, UpHoldingMeta(kA)), std::vector{Meta(kA)});

  held.Press(Meta(kA));
  held.Press(Meta(kB));
  EXPECT_EQ(Released(held, UpHoldingMeta(kA)), std::vector{Meta(kA)});
  EXPECT_EQ(Released(held, UpHoldingMeta(kB)), std::vector{Meta(kB)});
}

TEST(HeldChordsTest, AModifierComingUpReleasesEveryChordHoldingItInOrder) {
  HeldChords<Press> held;
  held.Press(Meta(kB));
  held.Press(Meta(kA));

  EXPECT_EQ(Released(held, UpHoldingNothing(kLeftMeta)),
            (std::vector{Meta(kB), Meta(kA)}));
}

// The compositor can press a chord the page already holds.
TEST(HeldChordsTest, AChordPressedTwiceIsReleasedOnce) {
  HeldChords<Press> held;
  held.Press(Meta(kA));
  held.Press(Meta(kA));

  EXPECT_EQ(Released(held, UpHoldingMeta(kA)), std::vector{Meta(kA)});
}

}  // namespace
}  // namespace domicile
