// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_VIEWS_WIDGET_DESKTOP_AURA_DOMICILE_CURSOR_COLOR_SCHEME_H_
#define UI_VIEWS_WIDGET_DESKTOP_AURA_DOMICILE_CURSOR_COLOR_SCHEME_H_

#include <optional>

#include "base/functional/callback.h"
#include "base/scoped_observation.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/native_theme/native_theme.h"
#include "ui/native_theme/native_theme_observer.h"

namespace views {

// The two colors `wm::CursorLoader` renders its cursor art in.
struct CursorColors {
  SkColor fill;
  // Unset keeps the art's own white outline.
  std::optional<SkColor> outline;
};

// Returns the pointer colors for `scheme`. Dark schemes invert the default
// black-on-white art so it stays visible.
CursorColors CursorColorsFor(ui::NativeTheme::PreferredColorScheme scheme);

// Reports pointer colors now and whenever the process color scheme changes.
//
// `components/domicile/browser/color_scheme.h` sets that scheme. Only cursors
// drawn from Chromium's art are recolored: all of them on a console (patch
// 0026), none in a nested desktop, which uses the host's cursor theme.
class CursorColorScheme : public ui::NativeThemeObserver {
 public:
  using ColorsChanged = base::RepeatingCallback<void(const CursorColors&)>;

  // Runs `colors_changed` before returning, with the colors `theme` has now.
  CursorColorScheme(ui::NativeTheme* theme, ColorsChanged colors_changed);

  CursorColorScheme(const CursorColorScheme&) = delete;
  CursorColorScheme& operator=(const CursorColorScheme&) = delete;

  ~CursorColorScheme() override;

  // ui::NativeThemeObserver:
  void OnNativeThemeUpdated(ui::NativeTheme* observed_theme) override;

 private:
  // Recoloring discards every cached cursor, so only scheme changes are
  // reported, not contrast or forced-colors updates.
  ui::NativeTheme::PreferredColorScheme scheme_;
  ColorsChanged colors_changed_;
  base::ScopedObservation<ui::NativeTheme, ui::NativeThemeObserver>
      observation_{this};
};

}  // namespace views

#endif  // UI_VIEWS_WIDGET_DESKTOP_AURA_DOMICILE_CURSOR_COLOR_SCHEME_H_
