// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/will_navigate_throttle.h"

#include <memory>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/domicile/browser/will_navigate.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle_registry.h"

namespace domicile {

// static
void WillNavigateThrottle::Add(content::NavigationThrottleRegistry& registry) {
  registry.AddThrottle(std::make_unique<WillNavigateThrottle>(registry));
}

WillNavigateThrottle::WillNavigateThrottle(
    content::NavigationThrottleRegistry& registry)
    : content::NavigationThrottle(registry) {}

WillNavigateThrottle::~WillNavigateThrottle() = default;

content::NavigationThrottle::ThrottleCheckResult
WillNavigateThrottle::WillStartRequest() {
  content::NavigationHandle& navigation = *navigation_handle();
  if (!AsksBeforeNavigating(navigation.IsInPrimaryMainFrame(),
                            navigation.IsRendererInitiated(),
                            navigation.GetPageTransition())) {
    return PROCEED;
  }
  // A guest's navigation, so there is a guest; see Add.
  WebViewGuest::FromWebContents(navigation.GetWebContents())
      ->AskToNavigate(navigation.GetURL(),
                      base::BindOnce(&WillNavigateThrottle::Answered,
                                     weak_factory_.GetWeakPtr()));
  return DEFER;
}

void WillNavigateThrottle::Answered(bool proceed) {
  if (proceed) {
    Resume();
  } else {
    // The will-navigate guard greps for this.
    LOG(INFO) << "domicile: the shell canceled a <webview>'s navigation to "
              << navigation_handle()->GetURL().possibly_invalid_spec() << ".";
    CancelDeferredNavigation(CANCEL_AND_IGNORE);
  }
}

const char* WillNavigateThrottle::GetNameForLogging() {
  return "DomicileWillNavigateThrottle";
}

}  // namespace domicile
