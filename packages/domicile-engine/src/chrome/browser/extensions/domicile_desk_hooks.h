// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_EXTENSIONS_DOMICILE_DESK_HOOKS_H_
#define CHROME_BROWSER_EXTENSIONS_DOMICILE_DESK_HOOKS_H_

#include "base/functional/callback_forward.h"

namespace content {
class BrowserContext;
class WebContents;
}  // namespace content

namespace extensions {

class WindowController;

namespace api::tabs {
struct Tab;
}  // namespace api::tabs

// Hooks that let Chrome's extension tab lookups see Domicile's desk, which
// exposes every <webview> as a tab of one window. See
// docs/architecture/EXTENSIONS.md#tabs. Each hook is called from one of
// Chrome's tab lookups by a line in the patch series.
//
// This lives in //chrome/browser/extensions because
// //chrome/browser/domicile depends on this target, and GN forbids cycles.
// The desk installs itself at startup (see
// //chrome/browser/domicile/domicile_desk.h).
namespace domicile_desk {

class Desk {
 public:
  virtual ~Desk() = default;

  // The desk's window in `context`, or null where it has none.
  virtual WindowController* WindowFor(content::BrowserContext* context) = 0;

  // The desk tab `tab_id` in `context`, with its window and index.
  virtual bool FindTab(int tab_id,
                       content::BrowserContext* context,
                       WindowController** window,
                       content::WebContents** contents,
                       int* index) = 0;

  // Fixes the index and active state of a desk tab, which a tab object built
  // without a tab strip gets wrong.
  virtual void AmendTab(content::WebContents& contents,
                        api::tabs::Tab& tab) = 0;

  virtual void ForEachTab(
      const base::RepeatingCallback<void(content::WebContents*)>& callback) = 0;
};

// Installs `desk` for the life of the process. Call once.
void Install(Desk& desk);

// Each hook does nothing until Install.
WindowController* WindowFor(content::BrowserContext* context);
bool FindTab(int tab_id,
             content::BrowserContext* context,
             WindowController** window,
             content::WebContents** contents,
             int* index);
void AmendTab(content::WebContents& contents, api::tabs::Tab& tab);
void ForEachTab(
    const base::RepeatingCallback<void(content::WebContents*)>& callback);

}  // namespace domicile_desk
}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_DOMICILE_DESK_HOOKS_H_
