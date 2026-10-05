// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_DEVTOOLS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_DEVTOOLS_H_

#include <optional>

#include "ui/gfx/geometry/point.h"

namespace content {
class RenderFrameHost;
class WebContents;
}  // namespace content

namespace domicile {

// DevTools for a page in a <webview>, shown in a desk browser window.
//
// Chrome's DevToolsWindow opens its own Browser, which no CRTC shows on a tty.
// Instead:
// - The page's guest opens a browser window at DevTools' address
//   (WebViewGuest::RequestWindow). DevToolsUI gives it unattached
//   DevToolsUIBindings.
// - This attaches those bindings to the oldest page waiting, with a delegate
//   that focuses or closes the window.

// Open DevTools on `frame`'s page (a <webview> guest), inspecting the element
// at `root_point` (root view coordinates) when given. If DevTools is already
// open for the page, asks the shell to focus it. WebViewGuest's
// InspectCallback, set in StartDesk.
void OpenDevTools(content::RenderFrameHost& frame,
                  std::optional<gfx::Point> root_point);

// Attach DevTools in `guest` when it loads the front end while a page is
// waiting. Run on every browser window guest.
void WatchForDevTools(content::WebContents& guest);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_DEVTOOLS_H_
