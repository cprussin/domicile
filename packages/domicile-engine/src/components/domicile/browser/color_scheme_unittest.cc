// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/color_scheme.h"

#include <optional>

#include "components/domicile/mojom/control_channel.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/native_theme/native_theme.h"

namespace domicile {
namespace {

using ui::NativeTheme;

// The override is process-wide, so each test puts back what it found.
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
  // After a dark one, because a toggle is a change and not a first setting.
  SetProcessColorScheme(mojom::Theme::kDark);
  SetProcessColorScheme(mojom::Theme::kLight);
  EXPECT_EQ(NativeTheme::GetPreferredColorSchemeOverride(),
            NativeTheme::PreferredColorScheme::kLight);
}

}  // namespace
}  // namespace domicile
