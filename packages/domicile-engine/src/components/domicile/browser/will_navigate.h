// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_WILL_NAVIGATE_H_
#define COMPONENTS_DOMICILE_BROWSER_WILL_NAVIGATE_H_

#include "ui/base/page_transition_types.h"

namespace domicile {

// Whether a <webview>'s navigation asks the shell first, which may cancel it
// (`domicile-will-navigate`, like Electron's `will-navigate`).
//
// Only a navigation the page starts in its main frame: a link, a form or a
// script setting `location`. Not the shell's own (`src`, goBack(), reload()),
// a subframe's, a history step or a reload.
bool AsksBeforeNavigating(bool main_frame,
                          bool renderer_initiated,
                          ui::PageTransition transition);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_WILL_NAVIGATE_H_
