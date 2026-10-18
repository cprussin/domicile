// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESKTOP_PREFS_H_
#define COMPONENTS_DOMICILE_BROWSER_DESKTOP_PREFS_H_

class PrefService;

namespace domicile {

// Turns off password saving and filling, address and card autofill, translate
// offers, and the warning before an http page.
//
// Chrome draws these as bubbles over the page, which on a desktop is the shell;
// a lock screen's password field would prompt to save the password. Chrome
// draws the http warning as a dialog on the page's tab. A webview is in no tab,
// so nothing draws the dialog and the http page stays blank.
//
// Runs on every start because the profile persists and has no settings page to
// change them.
void TurnOffBrowserOffers(PrefService& prefs);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESKTOP_PREFS_H_
