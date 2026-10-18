// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_PRINTING_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_PRINTING_H_

class Profile;

namespace content {
class WebContents;
}  // namespace content

namespace domicile {

// Printing for a page in a <webview>, through the desktop's print dialog.
//
// Chrome's Print Preview is a chrome:// page in a tab-modal dialog, and a
// guest has neither. Every print uses the system dialog instead:
// PrintingContextLinux asks xdg-desktop-portal's Print interface
// (PrintDialogLinuxPortal), the compositor is its backend, and the shell draws
// the dialog. See docs/PORTALS.md.

// Turns Print Preview off in `profile`'s prefs, so a page's window.print()
// asks the system dialog too. Before any renderer starts: Chrome passes the
// pref to renderers on their command line.
void PrintWithTheSystemDialog(Profile& profile);

// Gives `guest` Chrome's PrintViewManager, which answers its page's print
// requests. Run on every guest.
void AttachPrinting(content::WebContents& guest);

// Prints `guest`'s page, or the focused frame's selection, through the system
// dialog. WebViewGuest's PrintCallback, set in StartDesk.
void PrintPage(content::WebContents& guest);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_PRINTING_H_
