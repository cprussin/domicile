// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_TRAY_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_TRAY_H_

#include "components/domicile/mojom/extension_tray.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"

namespace content {
class RenderFrameHost;
}  // namespace content

namespace domicile {

// Bind ExtensionTray for `frame`: the extensions with an action in the page's
// profile, sent whole on binding and on every change, and a click on one with
// no popup.
//
// THIS IS NOT THE ACCESS CONTROL, for BindControlChannel's reason. The caller
// registers it only for a document whose origin is domicile:// -- see
// PopulateChromeFrameBinders -- and that decision is the whole of the security
// property: an extension's own popup, a chrome-extension:// page in a
// <webview>, must not be able to click another extension's action.
//
// In //chrome rather than //components/domicile because an action is
// ExtensionActionManager's and its changes are ExtensionActionDispatcher's,
// and both are //chrome/browser/extensions. What is spelled rather than read --
// a badge color as CSS, an icon as a data: URL -- is next door in
// //components/domicile:extension_tray_entry, which is what has the tests.
void BindExtensionTray(content::RenderFrameHost* frame,
                       mojo::PendingReceiver<mojom::ExtensionTray> receiver);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_TRAY_H_
