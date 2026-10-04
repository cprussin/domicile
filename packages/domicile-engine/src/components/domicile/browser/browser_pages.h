// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGES_H_
#define COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGES_H_

class GURL;

namespace domicile {

// Whether `url` is a page Chrome serves itself: chrome:// or
// chrome-untrusted://.
//
// These pages expect a Chrome browser window. Some crash the browser process
// in a <webview>: HistoryUI looks up its tab, and a guest has none. See
// BrowserPageThrottle.
//
// Only navigations are checked. Subresources such as chrome://resources, which
// the PDF viewer loads, are unaffected.
bool IsBrowserPage(const GURL& url);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGES_H_
