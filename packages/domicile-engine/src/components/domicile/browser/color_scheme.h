// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_COLOR_SCHEME_H_
#define COMPONENTS_DOMICILE_BROWSER_COLOR_SCHEME_H_

#include "components/domicile/mojom/control_channel.mojom.h"

namespace domicile {

// Make the desktop's theme the color scheme every page in this process sees.
//
// The shell hears the theme as a `theme` event; a site in a browser window
// hears nothing of the kind. What it reads is `prefers-color-scheme`, which
// comes from this process's ui::NativeTheme -- and with no system above the
// desktop to have a preference, that was whatever the process started with.
// Setting the process-wide override is how Chrome's own "follow the system"
// is overruled, so it is what every NativeTheme observing the OS settings
// already reads, and each one notifies its pages when it moves.
//
// Must run on the UI thread, which NativeTheme belongs to. The compositor's
// socket is read on the IO thread, so the control channel is handed this
// already bound to a UI task runner -- see ControlChannel's constructor.
void SetProcessColorScheme(mojom::Theme theme);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_COLOR_SCHEME_H_
