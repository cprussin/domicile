// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DESK_FUNCTIONS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DESK_FUNCTIONS_H_

namespace domicile {

// Register the desk's chrome.tabs and chrome.windows functions over Chrome's,
// under the same names. ExtensionFunctionRegistry::Register is public and
// replaces an entry by name, so this takes no edit to Chrome's own.
//
// Mutations go where the thing they change lives (EXTENSIONS.md's table):
//
//   tabs.query                    the desk's tabs, matched by
//                                 //components/domicile:desk_tabs
//   tabs.update {url, muted}      the guest; the browser holds its WebContents
//   tabs.update {active}          the shell, as `domicile-focus-request`
//   windows.update {focused}      the same, on the active tab's element
//   tabs.create {url}             the shell, as `domicile-new-window` on the
//                                 active tab's element. Answered with the next
//                                 tab the desk gains
//   tabs.remove                   the shell, as `domicile-close`. Answered at
//                                 once: the shell is asked, not waited for
//   windows.get, getCurrent,      the desk, which is the one window
//   getLastFocused, getAll
//   RefusedOnDesk()               `not supported on a Domicile desk`
//
// Anything else -- tabs.get, reload, sendMessage, executeScript, goBack --
// is Chrome's own, finding a desk tab through the lookups' hooks.
void RegisterDeskFunctions();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_FUNCTIONS_H_
