// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/views/widget/desktop_aura/domicile/cursor_color_scheme.h"

#include <utility>

#include "base/notreached.h"
#include "ui/base/cursor/cursor.h"

namespace views {

CursorColors CursorColorsFor(ui::NativeTheme::PreferredColorScheme scheme) {
  switch (scheme) {
    case ui::NativeTheme::PreferredColorScheme::kDark:
      return {.fill = SK_ColorWHITE, .outline = SK_ColorBLACK};
    case ui::NativeTheme::PreferredColorScheme::kLight:
    case ui::NativeTheme::PreferredColorScheme::kNoPreference:
      return {.fill = ui::kDefaultCursorColor, .outline = std::nullopt};
  }
  // No default case, so `-Wswitch` flags any new member.
  NOTREACHED();
}

CursorColorScheme::CursorColorScheme(ui::NativeTheme* theme,
                                     ColorsChanged colors_changed)
    : scheme_(theme->preferred_color_scheme()),
      colors_changed_(std::move(colors_changed)) {
  observation_.Observe(theme);
  colors_changed_.Run(CursorColorsFor(scheme_));
}

CursorColorScheme::~CursorColorScheme() = default;

void CursorColorScheme::OnNativeThemeUpdated(ui::NativeTheme* observed_theme) {
  const ui::NativeTheme::PreferredColorScheme scheme =
      observed_theme->preferred_color_scheme();
  if (scheme == scheme_) {
    return;
  }
  scheme_ = scheme;
  colors_changed_.Run(CursorColorsFor(scheme_));
}

}  // namespace views
