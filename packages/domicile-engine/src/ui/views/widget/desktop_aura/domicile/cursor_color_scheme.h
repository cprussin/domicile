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
  // The art's own, which is white, when there is none.
  std::optional<SkColor> outline;
};

// The pointer a desk in `scheme` is drawn with: the art as it is, a black fill
// in a white outline, unless the desk is dark, where that is a dark arrow on
// dark panels and it is turned inside out.
CursorColors CursorColorsFor(ui::NativeTheme::PreferredColorScheme scheme);

// Tells whoever draws the pointer which colors to draw it in, now and each
// time the desk turns.
//
// What it follows is the process's color scheme, which is the desk's windows
// theme -- `components/domicile/browser/color_scheme.h` is what sets it. So
// the pointer turns with the windows, after the shell has, which is the same
// moment the sites in its browser windows do.
//
// Only a cursor drawn from Chromium's own art is recolored, and on a console
// that is every one of them (patch 0026). A nested desktop draws the host's
// cursor theme, which is the host's to color.
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
  // Recoloring throws away every cursor the loader has made, and an update is
  // as often contrast or forced colors as it is the scheme, so only a turn is
  // passed on.
  ui::NativeTheme::PreferredColorScheme scheme_;
  ColorsChanged colors_changed_;
  base::ScopedObservation<ui::NativeTheme, ui::NativeThemeObserver>
      observation_{this};
};

}  // namespace views

#endif  // UI_VIEWS_WIDGET_DESKTOP_AURA_DOMICILE_CURSOR_COLOR_SCHEME_H_
