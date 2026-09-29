// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_tab_helpers.h"

#include "chrome/browser/domicile/domicile_desk.h"
#include "chrome/browser/extensions/tab_helper.h"
#include "chrome/browser/sessions/session_tab_helper_factory.h"
#include "content/public/browser/web_contents.h"

namespace domicile {

void AttachTabHelpers(content::WebContents& guest) {
  // Chrome's own factory rather than SessionTabHelper::CreateForWebContents,
  // because the factory is also what tells the ExtensionWebContentsObserver to
  // follow the tab's window id. It hands the helper the profile's
  // SessionService too, and that records nothing for a guest: the service
  // tracks only the windows of Browsers it was told about
  // (SessionServiceBase::ShouldTrackChangesToWindow), and a guest's window id
  // is none of them. A desk that restored its browser windows from Chrome's
  // session would be a different feature, and the shell's.
  CreateSessionServiceTabHelper(&guest);
  extensions::TabHelper::CreateForWebContents(&guest);

  // And a tab of the desk's one window, now that it has an id to be one by.
  AddToDesk(guest);
}

}  // namespace domicile
