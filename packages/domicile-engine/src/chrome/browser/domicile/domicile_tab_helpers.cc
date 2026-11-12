// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_tab_helpers.h"

#include "base/check.h"
#include "chrome/browser/domicile/domicile_desk.h"
#include "chrome/browser/domicile/domicile_devtools.h"
#include "chrome/browser/domicile/domicile_permissions.h"
#include "chrome/browser/domicile/domicile_printing.h"
#include "chrome/browser/extensions/api/web_navigation/web_navigation_tab_observer.h"
#include "chrome/browser/extensions/tab_helper.h"
#include "chrome/browser/favicon/favicon_utils.h"
#include "chrome/browser/history/history_tab_helper.h"
#include "chrome/browser/sessions/session_tab_helper_factory.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/view_type_utils.h"
#include "extensions/common/mojom/view_type.mojom.h"

namespace domicile {
namespace {

void Attach(content::WebContents& guest, bool records_history) {
  // Before the popup check: a popup's page may ask for permissions too.
  AttachPermissionPrompts(guest);
  // A popup's page may print too.
  AttachPrinting(guest);

  // An action popup is not a tab, as in Chrome. Without a SessionTabHelper,
  // tabs.getCurrent() returns nothing and it never becomes the active tab.
  WebViewGuest* web_view = WebViewGuest::FromWebContents(&guest);
  CHECK(web_view);
  if (web_view->extension_popup()) {
    extensions::SetViewType(&guest,
                            extensions::mojom::ViewType::kExtensionPopup);
    return;
  }

  // Use Chrome's factory because it also makes ExtensionWebContentsObserver
  // track the tab's window id. The SessionService it attaches records nothing
  // for guests (SessionServiceBase::ShouldTrackChangesToWindow), nor for a
  // private page's off-the-record profile, which has none.
  CreateSessionServiceTabHelper(&guest);

  // Visits and their favicons go into the profile's history, which the
  // History app reads, except an app window's. A private page keeps none.
  if (!guest.GetBrowserContext()->IsOffTheRecord()) {
    if (records_history) {
      HistoryTabHelper::GetOrCreateForWebContents(&guest)->set_desk_tab();
    }
    favicon::CreateContentFaviconDriverForWebContents(&guest);
  }

  // Set the view type before extensions::TabHelper, as Chrome's
  // tab_helpers.cc does. A kInvalid view type crashes runtime.getContexts
  // (called by Bitwarden's popup) on a NOTREACHED.
  if (extensions::GetViewType(&guest) ==
      extensions::mojom::ViewType::kInvalid) {
    extensions::SetViewType(&guest, extensions::mojom::ViewType::kTabContents);
  }
  // As Chrome's TabFeatures does. Without it no frame has a navigation state,
  // so webNavigation sends no events and getAllFrames lists nothing, and
  // extensions that fill through it, such as 1Password, find no page.
  extensions::WebNavigationTabObserver::CreateForWebContents(&guest);
  extensions::TabHelper::CreateForWebContents(&guest);

  // Needs the tab id assigned above.
  AddToDesk(guest);

  // So this guest can become a DevTools window.
  WatchForDevTools(guest);
}

}  // namespace

void AttachTabHelpers(content::WebContents& guest) {
  Attach(guest, /*records_history=*/true);
}

void AttachAppTabHelpers(content::WebContents& guest) {
  Attach(guest, /*records_history=*/false);
}

}  // namespace domicile
