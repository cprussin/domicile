// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_BROWSER_WINDOWS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_BROWSER_WINDOWS_H_

#include "components/domicile/mojom/browser_windows.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

class GURL;

namespace content {
class RenderFrameHost;
}  // namespace content

namespace domicile {

// The desk's browser windows, one list per profile. The profile owns each
// window's page, so `domicile load-shell` keeps them. See
// components/domicile/mojom/browser_windows.mojom.
//
// - Window: a WebViewGuest from WebViewGuest::MakeWindow, owned by the
//   shell's WebContents, and a tab of the desk.
// - Shown: by a <webview window="id">, which attaches the page. Content
//   detaches it when the element's frame goes.
// - Opened by: `domicile open-url`, a page's new window, an extension's
//   tabs.create or windows.create, or the shell (mojom::BrowserWindows.Open).
// - Closed by: its page's window.close(), an extension's tabs.remove, or the
//   shell (mojom::BrowserWindows.Close).
//
// Every open and close sends the whole list to every shell document of the
// profile. A reloaded shell learns its windows this way.

// Installs WebViewGuest's BrowserWindowHost. Called once, from StartDesk.
void StartBrowserWindows();

// Opens a browser window at `url` in the shell's profile, for `domicile
// open-url`, or with `app` an app window, for `domicile open-app`. Returns
// false when there is no shell to own it.
bool OpenBrowserWindow(const GURL& url, bool app);

// Binds BrowserWindows for `frame`. Sends the whole list on binding and on
// every change, and takes the shell's opens and closes.
//
// Access control is the caller's, as for BindExtensionTray: it registers this
// only for a document whose origin is domicile://.
void BindBrowserWindows(content::RenderFrameHost* frame,
                        mojo::PendingReceiver<mojom::BrowserWindows> receiver);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_BROWSER_WINDOWS_H_
