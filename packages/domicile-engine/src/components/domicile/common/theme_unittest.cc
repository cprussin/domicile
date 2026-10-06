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

// `domicile_protocol::Theme`, `domicile_config::ThemeMode`, this header's list
// and `mojom::Theme` must name the same set. Only a test checks that.

TEST(ThemeTest, AWireNameBecomesTheThemeItNames) {
  EXPECT_EQ(ThemeFromWire<Mode>("dark"), Mode::kDark);
  EXPECT_EQ(ThemeFromWire<Mode>("light"), Mode::kLight);
}

TEST(ThemeTest, AnythingElseIsRefusedRatherThanGuessedAt) {
  // `system` is the most likely near miss: other desktops offer it, but
  // Domicile has no system preference to follow.
  EXPECT_EQ(ThemeFromWire<Mode>("system"), std::nullopt);
  EXPECT_EQ(ThemeFromWire<Mode>("Dark"), std::nullopt);
  EXPECT_EQ(ThemeFromWire<Mode>(""), std::nullopt);
  EXPECT_EQ(ThemeFromWire<Mode>("prefers-dark"), std::nullopt);
}

TEST(ThemeTest, EveryThemeHasExactlyOneWireNameAndRoundTrips) {
  // Checks the list against `mojom::Theme`'s generated `kMaxValue`. A mojom
  // variant missing from the list fails the count; a wrong name fails the
  // round trip.
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
