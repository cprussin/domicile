// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_COLOR_SCHEME_H_
#define COMPONENTS_DOMICILE_BROWSER_COLOR_SCHEME_H_

#include "components/domicile/mojom/control_channel.mojom.h"

namespace domicile {

// Applies the desktop theme as `prefers-color-scheme` for every page in this
// process.
//
// Sites read `prefers-color-scheme` from ui::NativeTheme, not the shell's
// `theme` event. The process-wide override reaches every NativeTheme, and each
// notifies its pages on change.
//
// Must run on the UI thread. The control channel reads on the IO thread, so it
// receives this bound to a UI task runner; see ControlChannel's constructor.
void SetProcessColorScheme(mojom::Theme theme);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_COLOR_SCHEME_H_
