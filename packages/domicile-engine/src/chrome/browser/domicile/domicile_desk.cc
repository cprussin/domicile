// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk.h"

#include <optional>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "chrome/browser/domicile/domicile_desk_functions.h"
#include "chrome/browser/domicile/domicile_devtools.h"
#include "chrome/browser/domicile/domicile_window_controller.h"
#include "chrome/browser/extensions/domicile_desk_hooks.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/extensions/api/tabs.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/web_contents.h"

namespace domicile {
namespace {

// What Chrome's lookups reach through domicile_desk_hooks.h.
class DeskHooks final : public extensions::domicile_desk::Desk {
 public:
  extensions::WindowController* WindowFor(
      content::BrowserContext* context) override {
    return DomicileWindowController::Find(context);
  }

  bool FindTab(int tab_id,
               content::BrowserContext* context,
               extensions::WindowController** window,
               content::WebContents** contents,
               int* index) override {
    DomicileWindowController* desk = DomicileWindowController::Find(context);
    DomicileWindowController* found =
        desk == nullptr ? nullptr : desk->WindowWithTab(tab_id);
    if (found == nullptr) {
      return false;
    }
    content::WebContents* tab = found->TabWithId(tab_id);
    if (window != nullptr) {
      *window = found;
    }
    if (contents != nullptr) {
      *contents = tab;
    }
    if (index != nullptr) {
      *index = found->IndexOf(*tab);
    }
    return true;
  }

  // CreateTabObject found no tab strip for a guest, so it said index -1 and
  // inactive. The window it is a tab of knows both.
  void AmendTab(content::WebContents& contents,
                extensions::api::tabs::Tab& tab) override {
    DomicileWindowController* desk =
        DomicileWindowController::Find(contents.GetBrowserContext());
    DomicileWindowController* window =
        desk == nullptr ? nullptr : desk->WindowOf(contents);
    if (window != nullptr) {
      const bool active = window->IsActive(contents);
      tab.index = window->IndexOf(contents);
      tab.active = active;
      tab.selected = active;
      tab.highlighted = active;
    }
  }

  void ForEachTab(const base::RepeatingCallback<void(content::WebContents*)>&
                      callback) override {
    for (DomicileWindowController* window : DomicileWindowController::All()) {
      for (int i = 0; i < window->GetTabCount(); ++i) {
        callback.Run(window->GetWebContentsAt(i));
      }
    }
  }
};

}  // namespace

void StartDesk(Profile* profile) {
  // The process-wide half, once: the hooks, and the functions over Chrome's.
  // PostProfileInit is after BrowserProcessImpl set the ExtensionsBrowserClient
  // that ExtensionFunctionRegistry's first use registers Chrome's own
  // functions from, so these land over them rather than under.
  static const bool installed = [] {
    static base::NoDestructor<DeskHooks> hooks;
    extensions::domicile_desk::Install(*hooks);
    RegisterDeskFunctions();
    // The browser windows: the desk's tabs, opened and closed by guests and
    // shown by <webview window>.
    StartBrowserWindows();
    // DevTools, for a context menu's "inspect" and <webview>.inspect().
    WebViewGuest::SetInspect(base::BindRepeating(&OpenDevTools));
    return true;
  }();
  CHECK(installed);

  DomicileWindowController::For(profile);
}

void AddToDesk(content::WebContents& guest) {
  DomicileWindowController& desk = DomicileWindowController::For(
      Profile::FromBrowserContext(guest.GetBrowserContext()));
  WebViewGuest* web_view = WebViewGuest::FromWebContents(&guest);
  CHECK(web_view);
  const std::optional<int> popup_window = web_view->popup_window();
  if (!popup_window.has_value()) {
    desk.Add(guest);
    return;
  }
  // A browser window opened as a popup window's tab. If the popup window no
  // longer awaits a tab (windows.remove ran first), the guest still needs a
  // window, so it joins the desk's and logs a warning.
  DomicileWindowController* popup = desk.PopupAwaitingTab(*popup_window);
  if (popup == nullptr) {
    LOG(WARNING) << "domicile: a <webview> named popup window " << *popup_window
                 << ", which is not waiting for a tab; it is a tab of the "
                    "desk.";
    desk.Add(guest);
    return;
  }
  LOG(INFO) << "domicile: a <webview> is the tab of popup window "
            << *popup_window << ".";
  popup->Add(guest);
}

content::WebContents* ActiveDeskTab(content::BrowserContext* context) {
  DomicileWindowController* desk = DomicileWindowController::Find(context);
  return desk == nullptr ? nullptr : desk->GetActiveTab();
}

bool AddDeskObserver(content::BrowserContext* context, DeskObserver* observer) {
  DomicileWindowController* desk = DomicileWindowController::Find(context);
  if (desk == nullptr) {
    return false;
  }
  desk->AddObserver(observer);
  return true;
}

void RemoveDeskObserver(content::BrowserContext* context,
                        DeskObserver* observer) {
  DomicileWindowController* desk = DomicileWindowController::Find(context);
  if (desk != nullptr) {
    desk->RemoveObserver(observer);
  }
}

}  // namespace domicile
