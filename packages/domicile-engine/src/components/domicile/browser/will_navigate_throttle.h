// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_WILL_NAVIGATE_THROTTLE_H_
#define COMPONENTS_DOMICILE_BROWSER_WILL_NAVIGATE_THROTTLE_H_

#include "base/memory/weak_ptr.h"
#include "content/public/browser/navigation_throttle.h"

namespace content {
class NavigationThrottleRegistry;
}  // namespace content

namespace domicile {

// Holds a <webview> guest's navigation until the shell answers
// `domicile-will-navigate`, and cancels it if the shell does. Which
// navigations ask: AsksBeforeNavigating.
//
// Cancels and ignores, so the guest stays on its current page and commits no
// error page.
class WillNavigateThrottle : public content::NavigationThrottle {
 public:
  // Adds a throttle to `registry`. The caller checks the navigation is in a
  // <webview> guest; see BrowserPageThrottle::MaybeCreateAndAdd.
  static void Add(content::NavigationThrottleRegistry& registry);

  explicit WillNavigateThrottle(content::NavigationThrottleRegistry& registry);
  WillNavigateThrottle(const WillNavigateThrottle&) = delete;
  WillNavigateThrottle& operator=(const WillNavigateThrottle&) = delete;
  ~WillNavigateThrottle() override;

  // content::NavigationThrottle:
  ThrottleCheckResult WillStartRequest() override;
  const char* GetNameForLogging() override;

 private:
  // Resumes or cancels the deferred navigation on the shell's answer.
  void Answered(bool proceed);

  base::WeakPtrFactory<WillNavigateThrottle> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_WILL_NAVIGATE_THROTTLE_H_
