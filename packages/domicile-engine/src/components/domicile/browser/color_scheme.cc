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
  // Not a fallback, for `ThemeToWire`'s reason in common/theme.h: mojo
  // rejects a value no case names, so one reaching here is a cast in this
  // repository.
  NOTREACHED();
}

}  // namespace

void SetProcessColorScheme(mojom::Theme theme) {
  ui::NativeTheme::SetPreferredColorSchemeOverride(ColorSchemeFor(theme));
}

}  // namespace domicile
