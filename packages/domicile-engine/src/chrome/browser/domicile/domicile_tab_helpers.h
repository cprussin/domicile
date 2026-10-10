// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_TAB_HELPERS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_TAB_HELPERS_H_

namespace content {
class WebContents;
}  // namespace content

namespace domicile {

// Makes a <webview>'s guest the tab extensions expect, then adds it to its
// profile's desk (domicile_desk.h).
//
// Attaches four of the helpers Chrome's TabHelpers::AttachTabHelpers adds,
// SessionTabHelper first because other helpers rely on its tab id:
//
//   SessionTabHelper        the tab id. chrome.tabs, declarativeNetRequest's
//                           `tabIds` and webRequest's `tabId` use it; without
//                           it every guest request is tab -1
//   extensions::TabHelper   activeTab grants, scripting.executeScript and the
//                           content rules registries
//   HistoryTabHelper        records visits in the profile's history
//   ContentFaviconDriver    records each visited page's favicon
//
// Skips the rest of Chrome's helpers, which are browser-tab UI the shell draws
// itself. Also watches for DevTools' front end loading in the guest
// (domicile_devtools.h).
//
// An extension action popup (WebViewGuest::extension_popup) gets only the
// popup view type and is not a tab, as in Chrome, so it records no history.
// Extensions that check for a popup to size themselves (such as Bitwarden)
// depend on this.
//
// A private guest, in the off-the-record profile, is not a tab either: no tab
// id and no desk window, so extensions do not see it. It is still watched for
// DevTools.
//
// WebViewGuest calls this for each guest it creates. It lives in //chrome
// because the helpers do.
void AttachTabHelpers(content::WebContents& guest);

// AttachTabHelpers for an app window's guest (`domicile open-app`), without
// HistoryTabHelper: an app's pages are not browsing, so its visits stay out of
// the history.
void AttachAppTabHelpers(content::WebContents& guest);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_TAB_HELPERS_H_
