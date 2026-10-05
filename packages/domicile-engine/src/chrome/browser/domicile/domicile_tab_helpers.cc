// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_tab_helpers.h"

#include "base/check.h"
#include "chrome/browser/domicile/domicile_desk.h"
#include "chrome/browser/domicile/domicile_devtools.h"
#include "chrome/browser/extensions/tab_helper.h"
#include "chrome/browser/sessions/session_tab_helper_factory.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/view_type_utils.h"
#include "extensions/common/mojom/view_type.mojom.h"

namespace domicile {

void AttachTabHelpers(content::WebContents& guest) {
  // AN EXTENSION'S ACTION POPUP IS NO TAB, as Chrome's toolbar bubble is none:
  // the popup view type, and nothing else here. With no SessionTabHelper it
  // has no tab id, so tabs.getCurrent() answers nothing; and in no window, so
  // it never becomes the active tab whose page the popup is about.
  WebViewGuest* web_view = WebViewGuest::FromWebContents(&guest);
  CHECK(web_view);
  if (web_view->extension_popup()) {
    extensions::SetViewType(&guest,
                            extensions::mojom::ViewType::kExtensionPopup);
    return;
  }

  // Chrome's own factory rather than SessionTabHelper::CreateForWebContents,
  // because the factory is also what tells the ExtensionWebContentsObserver to
  // follow the tab's window id. It hands the helper the profile's
  // SessionService too, and that records nothing for a guest: the service
  // tracks only the windows of Browsers it was told about
  // (SessionServiceBase::ShouldTrackChangesToWindow), and a guest's window id
  // is none of them. A desk that restored its browser windows from Chrome's
  // session would be a different feature, and the shell's.
  CreateSessionServiceTabHelper(&guest);

  // A tab's view type, as Chrome's tab_helpers.cc gives every tab before its
  // extensions::TabHelper. Without it a guest is kInvalid, and
  // runtime.getContexts -- which Bitwarden's popup calls on opening -- switches
  // on the view type of each of the extension's frames and NOTREACHEDs on it,
  // taking the browser down.
  if (extensions::GetViewType(&guest) ==
      extensions::mojom::ViewType::kInvalid) {
    extensions::SetViewType(&guest, extensions::mojom::ViewType::kTabContents);
  }
  extensions::TabHelper::CreateForWebContents(&guest);

  // And a tab of the desk's one window, now that it has an id to be one by.
  AddToDesk(guest);

  // So this guest can become a DevTools window.
  WatchForDevTools(guest);
}

}  // namespace domicile
