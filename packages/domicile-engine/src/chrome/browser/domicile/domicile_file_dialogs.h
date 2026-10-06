// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_FILE_DIALOGS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_FILE_DIALOGS_H_

namespace domicile {

// Routes every file dialog the browser opens to the shell.
//
// Replaces Chromium's dialog factory, so all callers are covered (file inputs,
// downloads, the PDF viewer's save, showSaveFilePicker). Chrome's portal
// dialog disables event listening on its parent window; on a console that
// window is the desk, so the dialog and the whole desk stop taking input.
//
// The dialog asks the page's <webview> through FileChooserRequested. A page in
// no <webview> (the shell itself) has no one to ask, so its dialog is
// canceled and logged.
//
// Must be called on the UI thread before any page can open a dialog.
void UseTheShellForFileDialogs();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_FILE_DIALOGS_H_
