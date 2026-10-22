// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DESK_POINTER_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DESK_POINTER_H_

namespace domicile {

// Reports every pointer move the browser process dispatches to
// `DeskPointer`, in the shell page's CSS pixels, for the compositor's screen
// casts. A pointer over the shell's page or a browser window reaches the
// compositor no other way.
//
// Must be called once, on the UI thread, once aura::Env exists
// (ChromeBrowserMainParts::PostBrowserStart).
void StartDeskPointer();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_POINTER_H_
