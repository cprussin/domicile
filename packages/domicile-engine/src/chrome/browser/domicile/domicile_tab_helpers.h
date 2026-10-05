// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_TAB_HELPERS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_TAB_HELPERS_H_

namespace content {
class WebContents;
}  // namespace content

namespace domicile {

// Make a <webview>'s guest the tab an extension expects it to be.
//
// Two of the helpers Chrome's TabHelpers::AttachTabHelpers gives every tab,
// and only these two, which is docs/architecture/EXTENSIONS.md's slice 1:
//
//   SessionTabHelper        the tab's id. It is what chrome.tabs names a tab
//                           by, and what declarativeNetRequest's `tabIds` and
//                           webRequest's `tabId` read -- without it every
//                           request from a guest is tab -1, which is "not a
//                           tab" to both
//   extensions::TabHelper   activeTab grants, scripting.executeScript, and the
//                           content rules registries a tab is watched by
//
// In that order, which is Chrome's: SessionTabHelper first "because it sets up
// the tab ID, and other helpers may rely on that" (chrome/browser/ui/
// tab_helpers.cc). TabHelper would make one itself if it were missing, but a
// helper attached as a side effect of another is a dependency nobody wrote down.
//
// NOT the rest of AttachTabHelpers, which is a browser tab's worth of UI --
// infobars, the find bar, translate, a hundred more -- for a window this
// desktop's shell draws. What the guest already has is what every WebContents
// gets: `AttachUniversalWebContentsObservers` gives it an
// ExtensionWebContentsObserver, which TabHelper's constructor needs.
//
// Then it adds the guest to its profile's desk -- domicile_desk.h, slice 2 --
// which is what makes it a tab chrome.tabs can find.
// It also watches for DevTools' front end loading in the guest (see
// domicile_devtools.h).
//
// EXCEPT AN EXTENSION'S ACTION POPUP: a <webview> with `extensionpopup` (see
// WebViewGuest::extension_popup). That guest gets the popup view type and
// none of the rest, as Chrome's toolbar bubble is an ExtensionHost and no tab.
// An extension that asks whether it is in a tab -- Bitwarden's, which sizes
// its body only in a popup, and otherwise fills whatever it is given -- gets
// Chrome's answer.
//
// Run by WebViewGuest on each guest it makes, as the GuestCreatedCallback the
// frame binders hand BindWebViewGuestHost -- here and not in
// //components/domicile because both helpers are //chrome's.
void AttachTabHelpers(content::WebContents& guest);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_TAB_HELPERS_H_
