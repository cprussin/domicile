// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_COMMAND_SOCKET_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_COMMAND_SOCKET_H_

namespace domicile {

// Starts answering commands on --domicile-command-socket. Does nothing
// without that switch.
//
// Lives in //chrome because `load_shell` navigates the shell's window, which
// it finds through //chrome/browser/ui's GlobalBrowserCollection.
//
// Must be called on the UI thread after the shell's window exists
// (ChromeBrowserMainParts::PostBrowserStart). Starting it from
// `BindControlChannel` would be wrong: that runs only once a shell page loads,
// so `load_shell` could not replace a shell that fails to load.
void StartCommandSocket();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_COMMAND_SOCKET_H_
