// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGES_H_
#define COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGES_H_

class GURL;

namespace domicile {

// Whether `url` is a page Chrome serves itself: chrome:// and
// chrome-untrusted://.
//
// NONE OF THEM MEANS ANYTHING ON A DESK. Each is Chrome's own UI for Chrome's
// own window -- its history, its downloads, its settings -- and a desk has no
// such window. Worse, they assume one: HistoryUI looks its tab up
// unconditionally, and opened in a <webview>, whose guest is in no tab strip,
// it took the browser process down. So a <webview> is refused them; see
// BrowserPageThrottle.
//
// A PAGE, NOT A RESOURCE. chrome://resources is loaded by the PDF viewer, an
// extension's page, and that is a subresource rather than a navigation, so
// nothing asks this about it.
bool IsBrowserPage(const GURL& url);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGES_H_
