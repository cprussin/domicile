// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_

namespace domicile {

// Keep the shell's one page on the desk, now and on every hotplug: hosted by
// a window on the fastest display, laid out over the desk's bounding box, and
// shown on every other display by a presenter window. See
// docs/architecture/ONE-PAGE-FOR-THE-DESK.md.
//
// A WINDOW PER CRTC, because `ScreenManager::FindWindowAt` binds a window to
// a display controller only on an exact rectangle match, and one window cannot
// be two rectangles.
//
// WHY THIS LIVES IN //chrome. Making a window is `CreateBrowserWindow` in
// //chrome/browser/ui/browser_window, the way carrying a `load_shell` out is
// //chrome/browser/ui's GlobalBrowserCollection -- see
// domicile_command_socket.h, which is here for the same reason and says it at
// length. The part that is a decision rather than a window is next door in
// //components/domicile:shell_windows, which is what has the tests.
//
// Must be called on the UI thread, and after the shell's own window exists:
// ChromeBrowserMainParts::PostBrowserStart, beside StartCommandSocket(). The
// host this opens, when the fastest display is another, is a copy of that one
// -- its profile, its URL -- so there is nothing to copy before it is there.
void StartShellWindows();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_
