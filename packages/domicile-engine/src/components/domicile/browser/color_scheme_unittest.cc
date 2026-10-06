// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/color_scheme.h"

#include <optional>

#include "components/domicile/mojom/control_channel.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/native_theme/native_theme.h"

namespace domicile {
namespace {

using ui::NativeTheme;

// The override is process-wide, so each test clears it.
class ColorSchemeTest : public testing::Test {
 protected:
  ~ColorSchemeTest() override {
    NativeTheme::SetPreferredColorSchemeOverride(std::nullopt);
  }
};

TEST_F(ColorSchemeTest, ADarkDeskIsADarkWeb) {
  SetProcessColorScheme(mojom::Theme::kDark);
  EXPECT_EQ(NativeTheme::GetPreferredColorSchemeOverride(),
            NativeTheme::PreferredColorScheme::kDark);
}

TEST_F(ColorSchemeTest, ALightDeskIsALightWeb) {
  // Starts dark to test a change rather than an initial setting.
  SetProcessColorScheme(mojom::Theme::kDark);
  SetProcessColorScheme(mojom::Theme::kLight);
  EXPECT_EQ(NativeTheme::GetPreferredColorSchemeOverride(),
            NativeTheme::PreferredColorScheme::kLight);
}

}  // namespace
}  // namespace domicile
