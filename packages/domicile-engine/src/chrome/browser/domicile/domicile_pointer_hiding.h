// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_POINTER_HIDING_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_POINTER_HIDING_H_

namespace domicile {

// Hides the pointer while typing and after a pause in pointer input, as the
// desk's `theme.cursor_hide_*` settings say. See
// components/domicile/browser/pointer_hiding.h.
//
// Must be called once, on the UI thread, once aura::Env exists
// (ChromeBrowserMainParts::PostBrowserStart).
void StartPointerHiding();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_POINTER_HIDING_H_
