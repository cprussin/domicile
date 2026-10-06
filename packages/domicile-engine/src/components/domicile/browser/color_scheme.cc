// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/color_scheme.h"

#include "base/notreached.h"
#include "ui/native_theme/native_theme.h"

namespace domicile {
namespace {

ui::NativeTheme::PreferredColorScheme ColorSchemeFor(mojom::Theme theme) {
  switch (theme) {
    case mojom::Theme::kDark:
      return ui::NativeTheme::PreferredColorScheme::kDark;
    case mojom::Theme::kLight:
      return ui::NativeTheme::PreferredColorScheme::kLight;
  }
  // Mojo rejects unknown enum values, so reaching here means a bad cast in
  // this repository. See `ThemeToWire` in common/theme.h.
  NOTREACHED();
}

}  // namespace

void SetProcessColorScheme(mojom::Theme theme) {
  ui::NativeTheme::SetPreferredColorSchemeOverride(ColorSchemeFor(theme));
}

}  // namespace domicile
