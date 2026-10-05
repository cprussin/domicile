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
//   tabs.query                    every window's tabs, matched by
//                                 //components/domicile:desk_tabs
//   tabs.update {url, muted}      the guest; the browser holds its WebContents
//   tabs.update {active}          the shell, as `domicile-focus-request`
//   windows.update {focused}      the same, on that window's active tab
//   tabs.create {url}             opens a browser window. Answered with the
//                                 next tab the desk gains
//   windows.create {type: popup,  a popup window, made here with no tab, plus
//   url}                          a browser window as its tab. Answered once
//                                 the tab is attached
//   tabs.remove                   closes a browser window, or fires
//                                 `domicile-close` on a shell's own page.
//                                 Answered immediately
//   windows.remove                a popup window's tab, the same way. The
//                                 desk's own window is refused
//   tabs.setZoom, getZoom         the guest's zoom, as its element's setZoom
//                                 sets it: per site, through HostZoomMap
//   tabs.getZoomSettings,         automatic and per-origin, the guest's one
//   setZoomSettings               mode; setting any other is refused
//   windows.get, getCurrent,      the desk's window and its popup windows.
//   getLastFocused, getAll        "Current" is the caller's tab's window, or
//                                 the desk's for a caller in no tab
//   RefusedOnDesk()               `not supported on a Domicile desk`
//
// Anything else -- tabs.get, reload, sendMessage, executeScript, goBack --
// is Chrome's own, finding a desk tab through the lookups' hooks.
void RegisterDeskFunctions();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_FUNCTIONS_H_
