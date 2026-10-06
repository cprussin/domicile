// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_

namespace domicile {

// Keeps the shell's page on the desk across hotplugs: hosted on the fastest
// display, laid out over the desk's bounding box, and mirrored to the others
// by presenter windows. See docs/architecture/ONE-PAGE-FOR-THE-DESK.md.
//
// Uses one window per CRTC because `ScreenManager::FindWindowAt` binds a
// window to a controller only on an exact rectangle match. The layout logic is
// in //components/domicile:shell_windows, which has the tests.
//
// Must be called on the UI thread after the shell's window exists
// (ChromeBrowserMainParts::PostBrowserStart). A new host copies that window's
// profile and URL.
void StartShellWindows();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_
