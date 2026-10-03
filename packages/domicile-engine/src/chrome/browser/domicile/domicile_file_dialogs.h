// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_FILE_DIALOGS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_FILE_DIALOGS_H_

namespace domicile {

// Make every file dialog the browser opens a question to the shell.
//
// WHY EVERY ONE, AND NOT ONE CALLER AT A TIME. Patch 0053 routed the two a
// page reaches most -- `<input type="file">` and a download -- and the rest
// still opened Chrome's own: the PDF viewer's save (chrome.fileSystem
// .chooseEntry), a page's showSaveFilePicker(). That dialog goes through the
// desktop portal, and before it shows, SelectFileDialogLinuxPortal calls
// DisableEventListening on the window it is parented to. On a console that
// window is the desk: every key and click on the machine arrives through it,
// the portal's window's included. So the dialog drew and nothing could reach
// it, or anything else, and the desk had to be killed.
//
// So this replaces Chromium's dialog factory, which every dialog is made
// through, with one that asks the <webview> the page is in -- the same
// FileChooserRequested an `<input type="file">` asks. A dialog for a page in
// no <webview> -- the shell's own -- is refused: canceled, and said so in the
// log, because a desk draws no dialog of its own and there is no shell to ask.
//
// Must be called on the UI thread, before any page can open a dialog.
void UseTheShellForFileDialogs();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_FILE_DIALOGS_H_
