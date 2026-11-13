// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DESK_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DESK_H_

#include "base/observer_list_types.h"

class Profile;

namespace content {
class BrowserContext;
class WebContents;
}  // namespace content

namespace domicile {

// Exposes the desk to chrome.tabs and chrome.windows: each <webview> guest is
// a tab, and the desktop is one window. See
// docs/architecture/EXTENSIONS.md#tabs.
//
//   Tab         a WebViewGuest, by its SessionTabHelper id
//   Window      one DomicileWindowController per profile, in
//               WindowControllerList; its tabs are the live guests in
//               creation order
//   Active tab  the guest whose element last took focus
//               (//components/domicile:desk_tabs)
//   Popup       a windows.create window: another DomicileWindowController of
//               type `popup`, whose one tab is a browser window
//               (domicile_browser_windows.h)
//   Private     a private page is a tab of its off-the-record profile's
//               desk, as an incognito tab is of an incognito window. Only
//               extensions allowed in private windows see it; for them, the
//               desk of the two whose tab last took focus is current.
//
// Chrome's tab lookups walk tab strips, which guests are not in. Four of them
// call this desk through //chrome/browser/extensions/domicile_desk_hooks.h:
// ExtensionTabUtil::GetTabById, CreateTabObject and ForEachTab, and
// ChromeExtensionFunctionDetails::GetCurrentWindowController. The API
// functions are replaced instead (domicile_desk_functions.h). The desk
// dispatches tab and popup-window events itself, since Chrome's event routers
// only see Browser windows.

// Installs the lookup hooks and function overrides once per process, and
// creates `profile`'s window. Called per profile from
// ChromeBrowserMainParts::PostProfileInit.
void StartDesk(Profile* profile);

// Adds `guest` as a tab of the popup window its element names, or else of the
// desk's window. Must run after the tab helpers that assign its id.
void AddToDesk(content::WebContents& guest);

// Observes a profile desk's active tab, and its private profile's.
class DeskObserver : public base::CheckedObserver {
 public:
  virtual void OnActiveTabChanged() = 0;
};

// The active tab of `context`'s desk, or of its private profile's when a
// private page last took focus. Null with no desk or no tab, and for a private
// page without `include_private` (util::IsIncognitoEnabled), as Chrome hides
// an incognito window's tabs from an extension not allowed there.
content::WebContents* ActiveDeskTab(content::BrowserContext* context,
                                    bool include_private);

// Observes `context`'s desk. Returns false if it has none.
bool AddDeskObserver(content::BrowserContext* context, DeskObserver* observer);
void RemoveDeskObserver(content::BrowserContext* context,
                        DeskObserver* observer);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_H_
