// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_
#define COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_

#include <string_view>

class GURL;

namespace domicile {

// Whether a <webview> pinned to app host `app_host` may show `url`. A guest no
// app was opened in has an empty `app_host`.
//
// Anything but domicile://, except the app the guest is pinned to (see
// docs/architecture/APP-MODULES.md). A document on domicile://shell has the
// shell's origin, which is the only access control on the compositor's control
// channel and on guest creation, so a guest on it would act as a second shell
// steered by whatever supplied the URL (e.g. `target="_blank"` or an
// extension's `tabs.update`). An app's host follows from its path, so an
// unpinned guest on one would be any directory opened as an app.
// The check reads the origin, not the scheme, so shell-minted blobs and
// view-source: URLs are refused too.
bool MayShowInWebView(const GURL& url, std::string_view app_host);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_
