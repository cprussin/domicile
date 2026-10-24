// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_FORCE_DARK_H_
#define COMPONENTS_DOMICILE_BROWSER_FORCE_DARK_H_

#include <string>
#include <vector>

class GURL;

namespace domicile {

// Sites Chromium's auto dark mode draws dark while the desk is dark: the desk
// config's `theme.force_dark`, for sites with no dark theme of their own.
//
// ChromeContentBrowserClient asks ForcesDark when it computes a page's
// WebPreferences, which it does again on each navigation and each theme
// change. A new list applies from each page's next load.

// Replaces the sites, each a host name that also covers its subdomains. UI
// thread.
void SetForceDarkSites(std::vector<std::string> sites);

// Whether the page at `url` is drawn dark, given whether the desk is `dark`.
bool ForcesDark(const GURL& url, bool dark);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_FORCE_DARK_H_
