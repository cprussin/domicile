// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DESK_ACTIVITY_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DESK_ACTIVITY_H_

namespace domicile {

// Reports every input event the browser process dispatches to
// `DeskActivity`, for the compositor's idle clock. A key typed into a browser
// window or the shell's page reaches the compositor no other way. See
// `DeskActivityReporter`.
//
// Must be called once, on the UI thread, once the platform's event source
// exists (ChromeBrowserMainParts::PostBrowserStart).
void StartDeskActivity();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_ACTIVITY_H_
