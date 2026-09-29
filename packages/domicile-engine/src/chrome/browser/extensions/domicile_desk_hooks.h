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

// Where Chrome's own tab lookups ask Domicile's desk, which is every <webview>
// as a tab of one window. docs/architecture/EXTENSIONS.md's slice 2.
//
// A SEAM IN //chrome/browser/extensions RATHER THAN A CALL INTO
// //chrome/browser/domicile, because that target depends on this one and GN
// allows no cycle. The desk installs itself here once, at startup -- see
// //chrome/browser/domicile/domicile_desk.h -- and every hook below does
// nothing until it has. Each is one call from one of Chrome's lookups, added by
// the patch series; this file is the whole of what those lines reach.
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

  // What a tab object built with no tab strip gets wrong about a desk tab:
  // its index, and whether it is active.
  virtual void AmendTab(content::WebContents& contents,
                        api::tabs::Tab& tab) = 0;

  virtual void ForEachTab(
      const base::RepeatingCallback<void(content::WebContents*)>& callback) = 0;
};

// Installed once and for the life of the process.
void Install(Desk& desk);

// The hooks. Each is inert until Install.
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
