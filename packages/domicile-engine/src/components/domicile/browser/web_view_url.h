// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_
#define COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_

class GURL;

namespace domicile {

// Whether a <webview> may show `url`.
//
// ANYTHING BUT DOMICILE://. A document on it holds the shell's origin, and that
// origin is the whole of the access control on the compositor's control channel
// and on asking for guests -- so a guest on it would be a second shell, and
// whatever handed the shell the address (a page's `target="_blank"`, an
// extension's `tabs.update`) would be the one steering it. Read off the origin
// rather than the scheme, so a blob the shell minted is refused too, and
// through view-source:, which commits the source's own.
bool MayShowInWebView(const GURL& url);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_WEB_VIEW_URL_H_
