// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/extensions/domicile_desk_hooks.h"

#include "base/check.h"
#include "base/functional/callback.h"

namespace extensions::domicile_desk {
namespace {

Desk* g_desk = nullptr;

}  // namespace

void Install(Desk& desk) {
  CHECK(!g_desk);
  g_desk = &desk;
}

WindowController* WindowFor(content::BrowserContext* context) {
  return g_desk ? g_desk->WindowFor(context) : nullptr;
}

bool FindTab(int tab_id,
             content::BrowserContext* context,
             WindowController** window,
             content::WebContents** contents,
             int* index) {
  return g_desk && g_desk->FindTab(tab_id, context, window, contents, index);
}

void AmendTab(content::WebContents& contents, api::tabs::Tab& tab) {
  if (g_desk) {
    g_desk->AmendTab(contents, tab);
  }
}

void ForEachTab(
    const base::RepeatingCallback<void(content::WebContents*)>& callback) {
  if (g_desk) {
    g_desk->ForEachTab(callback);
  }
}

}  // namespace extensions::domicile_desk
