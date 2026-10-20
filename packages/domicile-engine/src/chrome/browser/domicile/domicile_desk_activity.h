// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DESK_ACTIVITY_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DESK_ACTIVITY_H_

namespace domicile {

// Reports every input event the browser process dispatches to
// `DeskActivity`, for the compositor's idle clock. A key typed into a browser
// window or the shell's page reaches the compositor no other way.
//
// `ui::UserActivityDetector` does the watching: it sees each event as the
// platform dispatches it, whatever page it is for, at most every 200 ms, and
// skips the mouse moves aura synthesizes under a still pointer.
//
// Must be called once, on the UI thread, once the platform's event source
// exists (ChromeBrowserMainParts::PostBrowserStart).
void StartDeskActivity();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_ACTIVITY_H_
