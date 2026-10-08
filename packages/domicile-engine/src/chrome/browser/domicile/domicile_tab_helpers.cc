// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_tab_helpers.h"

#include "base/check.h"
#include "chrome/browser/domicile/domicile_desk.h"
#include "chrome/browser/domicile/domicile_devtools.h"
#include "chrome/browser/domicile/domicile_permissions.h"
#include "chrome/browser/extensions/tab_helper.h"
#include "chrome/browser/sessions/session_tab_helper_factory.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/view_type_utils.h"
#include "extensions/common/mojom/view_type.mojom.h"

namespace domicile {

void AttachTabHelpers(content::WebContents& guest) {
  // Before the popup check: a popup's page may ask for permissions too.
  AttachPermissionPrompts(guest);

  // An action popup is not a tab, as in Chrome. Without a SessionTabHelper,
  // tabs.getCurrent() returns nothing and it never becomes the active tab.
  WebViewGuest* web_view = WebViewGuest::FromWebContents(&guest);
  CHECK(web_view);
  if (web_view->extension_popup()) {
    extensions::SetViewType(&guest,
                            extensions::mojom::ViewType::kExtensionPopup);
    return;
  }

  // A private page is not a tab extensions see, as an incognito tab is hidden
  // from extensions Chrome has not allowed there. The view type keeps
  // runtime.getContexts off its NOTREACHED; see below.
  if (guest.GetBrowserContext()->IsOffTheRecord()) {
    extensions::SetViewType(&guest, extensions::mojom::ViewType::kTabContents);
    WatchForDevTools(guest);
    return;
  }

  // Use Chrome's factory because it also makes ExtensionWebContentsObserver
  // track the tab's window id. The SessionService it attaches records nothing
  // for guests (SessionServiceBase::ShouldTrackChangesToWindow).
  CreateSessionServiceTabHelper(&guest);

  // Set the view type before extensions::TabHelper, as Chrome's
  // tab_helpers.cc does. A kInvalid view type crashes runtime.getContexts
  // (called by Bitwarden's popup) on a NOTREACHED.
  if (extensions::GetViewType(&guest) ==
      extensions::mojom::ViewType::kInvalid) {
    extensions::SetViewType(&guest, extensions::mojom::ViewType::kTabContents);
  }
  extensions::TabHelper::CreateForWebContents(&guest);

  // Needs the tab id assigned above.
  AddToDesk(guest);

  // So this guest can become a DevTools window.
  WatchForDevTools(guest);
}

}  // namespace domicile
