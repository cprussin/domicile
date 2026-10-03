// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGE_THROTTLE_H_
#define COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGE_THROTTLE_H_

#include "content/public/browser/navigation_throttle.h"

namespace content {
class NavigationThrottleRegistry;
}  // namespace content

namespace domicile {

// Refuses a <webview>'s guest every page Chrome serves itself. See
// IsBrowserPage for which those are and why none of them belongs on a desk.
//
// A THROTTLE AND NOT A CHECK WHERE `src` IS SET, because `src` is one of
// several ways in: a link, a redirect, an extension's tabs.create or
// tabs.update all navigate the guest without passing through it, and every
// one of them passes through here.
//
// CANCELED, NOT BLOCKED: the window stays on the page it had. A blocked
// navigation commits an error page, and committing one for a WebUI address in
// a guest is a fatal check in the browser process -- the first build of this
// throttle took the desktop down exactly as the page it refused would have.
//
// GUESTS ONLY. The shell's own window is launched by the command line and is
// trusted, and nothing else in the browser is a page a person navigates.
class BrowserPageThrottle : public content::NavigationThrottle {
 public:
  // Adds one to `registry` when its navigation is in a <webview>'s guest.
  static void MaybeCreateAndAdd(content::NavigationThrottleRegistry& registry);

  explicit BrowserPageThrottle(content::NavigationThrottleRegistry& registry);
  BrowserPageThrottle(const BrowserPageThrottle&) = delete;
  BrowserPageThrottle& operator=(const BrowserPageThrottle&) = delete;
  ~BrowserPageThrottle() override;

  // content::NavigationThrottle:
  ThrottleCheckResult WillStartRequest() override;
  const char* GetNameForLogging() override;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROWSER_PAGE_THROTTLE_H_
