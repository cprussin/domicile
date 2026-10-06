// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_page_throttle.h"

#include <memory>

#include "base/logging.h"
#include "components/domicile/browser/browser_pages.h"
#include "components/domicile/browser/web_view_guest.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle_registry.h"

namespace domicile {

// static
void BrowserPageThrottle::MaybeCreateAndAdd(
    content::NavigationThrottleRegistry& registry) {
  if (WebViewGuest::FromWebContents(
          registry.GetNavigationHandle().GetWebContents())) {
    registry.AddThrottle(std::make_unique<BrowserPageThrottle>(registry));
  }
}

BrowserPageThrottle::BrowserPageThrottle(
    content::NavigationThrottleRegistry& registry)
    : content::NavigationThrottle(registry) {}

BrowserPageThrottle::~BrowserPageThrottle() = default;

content::NavigationThrottle::ThrottleCheckResult
BrowserPageThrottle::WillStartRequest() {
  const GURL& url = navigation_handle()->GetURL();
  if (IsBrowserPage(url)) {
    // A guard script greps for this line to tell this refusal apart from an
    // ordinary load failure.
    LOG(INFO) << "domicile: a <webview> was refused a page Chrome serves "
                 "itself: "
              << url.spec();
    return CANCEL;
  } else {
    return PROCEED;
  }
}

const char* BrowserPageThrottle::GetNameForLogging() {
  return "DomicileBrowserPageThrottle";
}

}  // namespace domicile
