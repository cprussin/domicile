// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_

namespace domicile {

// Keep one shell window on every display, now and on every hotplug.
//
// A DESK OF THREE MONITORS SHOWED THE CHROME ON ONE. `--app=` opens a single
// window, `ScreenManager::FindWindowAt` binds a window to a display controller
// only on an exact rectangle match, and one window cannot be two rectangles --
// so the other two CRTCs had no window, and a modeset that lit them put
// nothing on them.
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
// windows this opens are copies of that one -- its profile, its URL -- so
// there is nothing to copy before it is there.
void StartShellWindows();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_SHELL_WINDOWS_H_
