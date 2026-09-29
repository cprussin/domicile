// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_desk.h"

#include "base/check.h"
#include "base/functional/callback.h"
#include "base/no_destructor.h"
#include "chrome/browser/domicile/domicile_desk_functions.h"
#include "chrome/browser/domicile/domicile_window_controller.h"
#include "chrome/browser/extensions/domicile_desk_hooks.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/extensions/api/tabs.h"
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
    content::WebContents* tab =
        desk == nullptr ? nullptr : desk->TabWithId(tab_id);
    if (tab == nullptr) {
      return false;
    }
    if (window != nullptr) {
      *window = desk;
    }
    if (contents != nullptr) {
      *contents = tab;
    }
    if (index != nullptr) {
      *index = desk->IndexOf(*tab);
    }
    return true;
  }

  // CreateTabObject found no tab strip for a guest, so it said index -1 and
  // inactive. The desk knows both.
  void AmendTab(content::WebContents& contents,
                extensions::api::tabs::Tab& tab) override {
    DomicileWindowController* desk =
        DomicileWindowController::Find(contents.GetBrowserContext());
    if (desk != nullptr && desk->Contains(contents)) {
      const bool active = desk->IsActive(contents);
      tab.index = desk->IndexOf(contents);
      tab.active = active;
      tab.selected = active;
      tab.highlighted = active;
    }
  }

  void ForEachTab(const base::RepeatingCallback<void(content::WebContents*)>&
                      callback) override {
    for (DomicileWindowController* desk : DomicileWindowController::All()) {
      for (int i = 0; i < desk->GetTabCount(); ++i) {
        callback.Run(desk->GetWebContentsAt(i));
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
    return true;
  }();
  CHECK(installed);

  DomicileWindowController::For(profile);
}

void AddToDesk(content::WebContents& guest) {
  DomicileWindowController::For(
      Profile::FromBrowserContext(guest.GetBrowserContext()))
      .Add(guest);
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
