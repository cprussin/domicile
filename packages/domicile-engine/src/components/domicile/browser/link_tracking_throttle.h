// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_LINK_TRACKING_THROTTLE_H_
#define COMPONENTS_DOMICILE_BROWSER_LINK_TRACKING_THROTTLE_H_

#include <optional>

#include "content/public/browser/navigation_throttle.h"
#include "url/gurl.h"

namespace content {
class NavigationThrottleRegistry;
}  // namespace content

namespace domicile {

// Takes the tracking out of a link from one site to another
// (WithoutTracking), in a profile that removes it
// (`protections.remove_tracking_from_links`), in the page's mode: Standard
// drops the click ids, Strict the campaign parameters too, Off nothing. Cancels the navigation,
// or its redirect, and starts it again at the address without them, as
// Brave's query filter does. See docs/architecture/AD-BLOCKING.md.
//
// Only a website page's own navigation: not a frame's, a form's POST, back,
// forward or a reload (which would add to its history), a link within a site
// (whose parameters may be its own), or an Electron app's page.
class LinkTrackingThrottle : public content::NavigationThrottle {
 public:
  // Adds a throttle to `registry`. The caller checks the navigation is in a
  // <webview> guest; see BrowserPageThrottle::MaybeCreateAndAdd.
  static void Add(content::NavigationThrottleRegistry& registry);

  explicit LinkTrackingThrottle(content::NavigationThrottleRegistry& registry);
  LinkTrackingThrottle(const LinkTrackingThrottle&) = delete;
  LinkTrackingThrottle& operator=(const LinkTrackingThrottle&) = delete;
  ~LinkTrackingThrottle() override;

  // content::NavigationThrottle:
  ThrottleCheckResult WillStartRequest() override;
  ThrottleCheckResult WillRedirectRequest() override;
  const char* GetNameForLogging() override;

 private:
  // `from` is the site the navigation comes from: its initiator's, or the
  // address that redirected it. None for one the user started.
  ThrottleCheckResult Check(const std::optional<GURL>& from);
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_LINK_TRACKING_THROTTLE_H_
