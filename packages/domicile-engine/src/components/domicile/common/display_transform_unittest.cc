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

// `domicile_protocol::DisplayTransform`, `domicile_config::Transform`, this
// header's list and `mojom::DisplayTransform` must name the same set. Only a
// test checks that: a missing wire name does not fail the build, it silently
// draws a monitor at the wrong rotation.

TEST(DisplayTransformTest, AWireNameBecomesTheTurnItNames) {
  // Swapping `rotate-90` and `rotate-270` would draw the desktop upside down
  // without an error.
  EXPECT_EQ(DisplayTransformFromWire<Turn>("normal"), Turn::kNormal);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate-90"), Turn::kRotate90);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate-180"), Turn::kRotate180);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate-270"), Turn::kRotate270);
}

TEST(DisplayTransformTest, AnythingElseIsRefusedRatherThanGuessedAt) {
  // `rotate270` is serde's default kebab-case name for `Rotate270`, so it is
  // the most likely near miss.
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate270"), std::nullopt);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("270"), std::nullopt);
  EXPECT_EQ(DisplayTransformFromWire<Turn>(""), std::nullopt);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("Normal"), std::nullopt);
  EXPECT_EQ(DisplayTransformFromWire<Turn>("rotate_90"), std::nullopt);
}

TEST(DisplayTransformTest, EveryTurnHasExactlyOneWireNameAndRoundTrips) {
  // Checks the list against `mojom::DisplayTransform`'s generated `kMaxValue`.
  // A mojom variant missing from the list fails the count; a wrong name fails
  // the round trip.
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
