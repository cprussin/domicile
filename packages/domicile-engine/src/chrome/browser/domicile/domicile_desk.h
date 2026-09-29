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

// A desk to chrome.tabs: every <webview> a tab, and the whole desktop one
// chrome.windows window. docs/architecture/EXTENSIONS.md's slice 2.
//
//   Tab         a WebViewGuest, by the id SessionTabHelper gave it
//   Window      one DomicileWindowController per profile, registered in
//               WindowControllerList. Its tabs are the live guests, in
//               creation order
//   Active tab  the guest whose element last took focus -- see
//               //components/domicile:desk_tabs for the rule
//
// HOW CHROME FINDS THEM. Its lookups walk browser windows' tab strips, which a
// guest is in none of. Four of them ask this desk through
// //chrome/browser/extensions/domicile_desk_hooks.h, one line each, added by
// the patch series: ExtensionTabUtil::GetTabById, CreateTabObject and
// ForEachTab, and ChromeExtensionFunctionDetails::GetCurrentWindowController.
//
// WHAT IS NOT A LOOKUP IS NOT PATCHED. chrome.tabs.query, update, create and
// remove, and chrome.windows.get* and update, are this desk's own
// ExtensionFunctions, registered over Chrome's under the same names -- see
// domicile_desk_functions.h -- and so are the refusals. Tab events come from
// the guests' own lifecycle, dispatched through the profile's EventRouter
// exactly as TabsEventRouter dispatches them, rather than from a tab strip.

// Install the desk: the lookups' hooks, the functions over Chrome's, and
// `profile`'s window. Once per profile, from ChromeBrowserMainParts::
// PostProfileInit; the process-wide half is done the first time only.
void StartDesk(Profile* profile);

// Make `guest` a tab of its profile's desk. Run by AttachTabHelpers, after the
// helpers that give it its id.
void AddToDesk(content::WebContents& guest);

// Hear the active tab change in a profile's desk.
class DeskObserver : public base::CheckedObserver {
 public:
  virtual void OnActiveTabChanged() = 0;
};

// The desk's active tab in `context`, or null: a profile with no desk, or a
// desk with no tabs.
content::WebContents* ActiveDeskTab(content::BrowserContext* context);

// Observe `context`'s desk. False, and nothing observed, where it has none.
bool AddDeskObserver(content::BrowserContext* context, DeskObserver* observer);
void RemoveDeskObserver(content::BrowserContext* context,
                        DeskObserver* observer);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DESK_H_
