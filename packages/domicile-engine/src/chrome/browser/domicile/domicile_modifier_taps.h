// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_MODIFIER_TAPS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_MODIFIER_TAPS_H_

namespace domicile {

// Hears every key, click, scroll, pinch and touch on the desk for the
// modifier taps the shell grabs, a tap of Super alone. See
// components/domicile/browser/desk_modifier_taps.h.
//
// Must be called once, on the UI thread, once aura::Env exists
// (ChromeBrowserMainParts::PostBrowserStart).
void StartModifierTaps();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_MODIFIER_TAPS_H_
