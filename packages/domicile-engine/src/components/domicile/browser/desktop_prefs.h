// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESKTOP_PREFS_H_
#define COMPONENTS_DOMICILE_BROWSER_DESKTOP_PREFS_H_

class PrefService;

namespace domicile {

// Turn off what Chrome offers a profile's user: saving and filling passwords,
// filling addresses and cards, and translating a page.
//
// Each offer is a bubble or a dropdown the browser draws over the page -- over
// the shell, on a desktop, where a lock screen's password field is a "save
// password?" prompt. None of it is the desktop's UI.
//
// Every start rather than once, because the profile outlives a run and
// nothing here has a settings page to turn one back on from.
void TurnOffBrowserOffers(PrefService& prefs);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESKTOP_PREFS_H_
