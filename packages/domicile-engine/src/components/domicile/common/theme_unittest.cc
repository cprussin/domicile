// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/common/theme.h"

#include <string_view>
#include <vector>

#include "components/domicile/mojom/control_channel.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using Mode = mojom::Theme;

// THE POINT OF THIS FILE IS THE THIRD TEST, and the first two are what make its
// failure readable. The compositor's `Theme` (domicile_protocol), the config's
// `ThemeMode`, this header's list and `mojom::Theme` are four spellings of one
// closed set, and nothing but a test makes them agree.

TEST(ThemeTest, AWireNameBecomesTheThemeItNames) {
  EXPECT_EQ(ThemeFromWire<Mode>("dark"), Mode::kDark);
  EXPECT_EQ(ThemeFromWire<Mode>("light"), Mode::kLight);
}

TEST(ThemeTest, AnythingElseIsRefusedRatherThanGuessedAt) {
  // `system` first, because it is the near miss this list is most likely to
  // meet: it is what every other desktop's third option is called, and a
  // reader that quietly took it for one of the two would be Domicile
  // deferring to itself. The rest are a case that is not the wire's, the
  // empty string, and the word a CSS media query uses.
  EXPECT_EQ(ThemeFromWire<Mode>("system"), std::nullopt);
  EXPECT_EQ(ThemeFromWire<Mode>("Dark"), std::nullopt);
  EXPECT_EQ(ThemeFromWire<Mode>(""), std::nullopt);
  EXPECT_EQ(ThemeFromWire<Mode>("prefers-dark"), std::nullopt);
}

TEST(ThemeTest, EveryThemeHasExactlyOneWireNameAndRoundTrips) {
  // Built from the same list the codec is, so this cannot check the list
  // against itself: what it checks is the list against `mojom::Theme`, whose
  // `kMaxValue` is generated from the mojom rather than from here. A variant
  // added to the mojom and not to the list fails on the count; one whose name
  // does not come back fails on the round trip.
  std::vector<Mode> named;
#define DOMICILE_THEME_CASE(theme, wire)                       \
  EXPECT_EQ(ThemeToWire(Mode::theme), std::string_view(wire)); \
  EXPECT_EQ(ThemeFromWire<Mode>(wire), Mode::theme);           \
  named.push_back(Mode::theme);
  DOMICILE_THEMES(DOMICILE_THEME_CASE)
#undef DOMICILE_THEME_CASE

  EXPECT_EQ(named.size(), static_cast<size_t>(Mode::kMaxValue) -
                              static_cast<size_t>(Mode::kMinValue) + 1u)
      << "a theme in the mojom has no wire name here, or the other way round";
}

}  // namespace
}  // namespace domicile
