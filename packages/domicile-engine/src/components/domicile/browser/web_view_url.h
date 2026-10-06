// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_
#define COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_

class GURL;

namespace domicile {

// Whether a <webview> may show `url`.
//
// Anything but domicile://. A document there has the shell's origin, which is
// the only access control on the compositor's control channel and on guest
// creation, so a guest on it would act as a second shell steered by whatever
// supplied the URL (e.g. `target="_blank"` or an extension's `tabs.update`).
// The check reads the origin, not the scheme, so shell-minted blobs and
// view-source: URLs are refused too.
bool MayShowInWebView(const GURL& url);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_
