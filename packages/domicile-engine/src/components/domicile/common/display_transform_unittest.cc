// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/display_transform.h"

#include <string_view>
#include <vector>

#include "components/domicile/mojom/control_channel.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Turn = mojom::DisplayTransform;

// THE POINT OF THIS FILE IS THE THIRD TEST, and the first two are what make its
// failure readable. The compositor's `DisplayTransform` (domicile_protocol),
// the config's `Transform`, this header's list and `mojom::DisplayTransform`
// are four spellings of one closed set, and nothing but a test makes them
// agree. A turn that loses its wire name does not fail a build: it lands a
// monitor on its side face-up, with nothing said.

TEST(DisplayTransformTest, AWireNameBecomesTheTurnItNames) {
  // All four, because there are only four and each is a separate chance to
  // mistype a hyphen. `rotate-90` and `rotate-270` are the pair that matter --
  // they are the two quarter turns, and swapping them is a desktop drawn
  // upside down rather than an error.
  EXPECT_EQ(DisplayTransformFromWire<Turn>("normal"), Turn::kNormal);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate-90"), Turn::kRotate90);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate-180"), Turn::kRotate180);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate-270"), Turn::kRotate270);
}

TEST(DisplayTransformTest, AnythingElseIsRefusedRatherThanGuessedAt) {
  // `rotate270` is serde's own kebab-case spelling of `Rotate270`, which is
  // why the Rust side writes each name out by hand -- it is the near miss this
  // list is most likely to meet. The rest are the degrees on their own, the
  // empty string, and a case that is not the wire's.
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate270"), std::nullopt);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("270"), std::nullopt);
  EXPECT_EQ(DisplayTransformFromWire<Turn>(""), std::nullopt);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("Normal"), std::nullopt);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate_90"), std::nullopt);
}

TEST(DisplayTransformTest, EveryTurnHasExactlyOneWireNameAndRoundTrips) {
  // Built from the same list the codec is, so this cannot check the list
  // against itself: what it checks is the list against
  // `mojom::DisplayTransform`, whose `kMaxValue` is generated from the mojom
  // rather than from here. A variant added to the mojom and not to the list
  // fails on the count; one whose name does not come back fails on the round
  // trip.
  std::vector<Turn> named;
#define DOMICILE_DISPLAY_TRANSFORM_CASE(turn, wire)                       \
  EXPECT_EQ(DisplayTransformToWire(Turn::turn), std::string_view(wire));  \
  EXPECT_EQ(DisplayTransformFromWire<Turn>(wire), Turn::turn);            \
  named.push_back(Turn::turn);
  DOMICILE_DISPLAY_TRANSFORMS(DOMICILE_DISPLAY_TRANSFORM_CASE)
#undef DOMICILE_DISPLAY_TRANSFORM_CASE

  EXPECT_EQ(named.size(),
            static_cast<size_t>(Turn::kMaxValue) -
                static_cast<size_t>(Turn::kMinValue) + 1u)
      << "a turn in the mojom has no wire name here, or the other way round";
}

}  // namespace
}  // namespace domicile
