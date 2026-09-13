// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_COMMAND_SOCKET_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_COMMAND_SOCKET_H_

namespace domicile {

// Start answering commands on --domicile-command-socket. An engine that was
// not given one binds nothing and listens on nothing, which is every engine
// nobody intends to command.
//
// WHY THIS LIVES IN //chrome AND NOT IN //components/domicile. Carrying a
// `load_shell` out means navigating the shell's own window, and that window is
// a chrome `Browser` -- `apps::OpenExtensionAppShortcutWindow`, from the
// patched startup_browser_creator.cc. Finding it is
// `GlobalBrowserCollection::GetInstance()`, which belongs to
// //chrome/browser/ui and which a //components/domicile target may not depend
// on. //content/browser/domicile is closed for the same kind of reason:
// //content/public/browser forwards to //content/browser, so a components
// target that content/browser links would cycle -- which is what
// //components/domicile:browser's own "deliberately does not depend on
// //content" comment is about.
//
// Must be called on the UI thread, and after the shell's window exists:
// ChromeBrowserMainParts::PostBrowserStart, which runs once
// `browser_creator_->Start` has opened it.
//
// STARTING IT FROM THE FORK'S OWN `BindControlChannel` WOULD COMPILE AND NEEDS
// NO PATCH, AND IS STILL WRONG. That binder runs when a shell page binds its
// control channel, so a shell whose module 404s never runs it -- and
// `load_shell` is the one command that could replace that broken shell, so it
// would be unreachable exactly when it is wanted. It is also a per-frame
// IO-thread binder starting a process-wide listener, which is a lifetime nobody
// would choose on purpose.
void StartCommandSocket();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_COMMAND_SOCKET_H_
