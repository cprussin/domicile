// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/views/widget/desktop_aura/domicile/cursor_color_scheme.h"

#include <optional>
#include <vector>

#include "base/functional/bind.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/cursor/cursor.h"
#include "ui/native_theme/native_theme.h"

namespace views {
namespace {

using ui::NativeTheme;

// The override is process-wide, so each test clears it.
class CursorColorSchemeTest : public testing::Test {
 protected:
  ~CursorColorSchemeTest() override {
    NativeTheme::SetPreferredColorSchemeOverride(std::nullopt);
  }

  CursorColorScheme::ColorsChanged Record() {
    return base::BindRepeating(
        [](std::vector<CursorColors>* seen, const CursorColors& colors) {
          seen->push_back(colors);
        },
        &seen_);
  }

  std::vector<CursorColors> seen_;
};

TEST_F(CursorColorSchemeTest, ADarkDeskHasALightPointer) {
  const CursorColors colors =
      CursorColorsFor(NativeTheme::PreferredColorScheme::kDark);
  EXPECT_EQ(colors.fill, SK_ColorWHITE);
  EXPECT_EQ(colors.outline, SK_ColorBLACK);
}

TEST_F(CursorColorSchemeTest, ALightDeskHasTheArtsOwnPointer) {
  const CursorColors colors =
      CursorColorsFor(NativeTheme::PreferredColorScheme::kLight);
  EXPECT_EQ(colors.fill, ui::kDefaultCursorColor);
  EXPECT_FALSE(colors.outline.has_value());
}

TEST_F(CursorColorSchemeTest, ThePointerTurnsWithTheDesk) {
  NativeTheme::SetPreferredColorSchemeOverride(
      NativeTheme::PreferredColorScheme::kLight);
  CursorColorScheme scheme(NativeTheme::GetInstanceForNativeUi(), Record());

  NativeTheme::SetPreferredColorSchemeOverride(
      NativeTheme::PreferredColorScheme::kDark);

  ASSERT_EQ(seen_.size(), 2u);
  EXPECT_EQ(seen_[0].fill, ui::kDefaultCursorColor);
  EXPECT_EQ(seen_[1].fill, SK_ColorWHITE);
}

TEST_F(CursorColorSchemeTest, AnUpdateThatKeepsTheSchemeRecolorsNothing) {
  // Recoloring discards cached cursors, so non-scheme updates are ignored.
  NativeTheme::SetPreferredColorSchemeOverride(
      NativeTheme::PreferredColorScheme::kDark);
  CursorColorScheme scheme(NativeTheme::GetInstanceForNativeUi(), Record());

  NativeTheme::GetInstanceForNativeUi()->NotifyOnNativeThemeUpdated();

  EXPECT_EQ(seen_.size(), 1u);
}

}  // namespace
}  // namespace views
