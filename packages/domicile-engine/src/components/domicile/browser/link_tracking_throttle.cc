// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/link_tracking_throttle.h"

#include <memory>
#include <optional>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/task/sequenced_task_runner.h"
#include "components/domicile/browser/link_tracking.h"
#include "components/domicile/browser/page_privacy.h"
#include "components/domicile/browser/site_privacy.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/referrer.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "ui/base/page_transition_types.h"

namespace domicile {

namespace {

// Starts the page's navigation again at `url`, as `navigation` was.
void NavigateAgain(base::WeakPtr<content::WebContents> contents,
                   content::NavigationController::LoadURLParams params) {
  if (contents) {
    contents->GetController().LoadURLWithParams(params);
  }
}

}  // namespace

// static
void LinkTrackingThrottle::Add(content::NavigationThrottleRegistry& registry) {
  registry.AddThrottle(std::make_unique<LinkTrackingThrottle>(registry));
}

LinkTrackingThrottle::LinkTrackingThrottle(
    content::NavigationThrottleRegistry& registry)
    : content::NavigationThrottle(registry) {}

LinkTrackingThrottle::~LinkTrackingThrottle() = default;

content::NavigationThrottle::ThrottleCheckResult
LinkTrackingThrottle::WillStartRequest() {
  const std::optional<url::Origin>& initiator =
      navigation_handle()->GetInitiatorOrigin();
  // A page's own navigation comes from its initiator; the user's, typed or
  // from the shell, from nowhere.
  if (navigation_handle()->IsRendererInitiated() && initiator.has_value()) {
    return Check(initiator->GetURL());
  }
  return Check(std::nullopt);
}

content::NavigationThrottle::ThrottleCheckResult
LinkTrackingThrottle::WillRedirectRequest() {
  // The redirect comes from the address before it: the last in the chain is
  // where it goes.
  const std::vector<GURL>& chain = navigation_handle()->GetRedirectChain();
  if (chain.size() < 2) {
    return PROCEED;
  }
  return Check(chain[chain.size() - 2]);
}

content::NavigationThrottle::ThrottleCheckResult LinkTrackingThrottle::Check(
    const std::optional<GURL>& from) {
  content::NavigationHandle& navigation = *navigation_handle();
  const ui::PageTransition transition = navigation.GetPageTransition();
  if (!navigation.IsInPrimaryMainFrame() || navigation.IsSameDocument() ||
      navigation.IsPost() ||
      (transition & ui::PAGE_TRANSITION_FORWARD_BACK) ||
      ui::PageTransitionCoreTypeIs(transition, ui::PAGE_TRANSITION_RELOAD)) {
    return PROCEED;
  }
  const GURL& url = navigation.GetURL();
  // A site's parameters on its own links may be its own.
  if (from.has_value() &&
      net::registry_controlled_domains::SameDomainOrHost(
          *from, url,
          net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES)) {
    return PROCEED;
  }
  content::WebContents& contents = *navigation.GetWebContents();
  // A guest's navigation, so there is a guest; see Add.
  const WebViewGuest& guest = *WebViewGuest::FromWebContents(&contents);
  if (guest.is_app_page()) {
    return PROCEED;
  }
  PagePrivacy::CreateForWebContents(&contents);
  const PagePrivacy& privacy = *PagePrivacy::FromWebContents(&contents);
  // The profile's, the site's or the window's, and off with all of the
  // page's protections.
  if (!privacy.IsOnFor(PageProtection::kRemoveTrackingFromLinks, url)) {
    return PROCEED;
  }
  const AdBlockingMode mode = privacy.ModeFor(url);
  const std::optional<GURL> without =
      WithoutTracking(url, mode == AdBlockingMode::kStrict);
  if (!without.has_value()) {
    return PROCEED;
  }

  content::NavigationController::LoadURLParams params(*without);
  params.referrer = content::Referrer(navigation.GetReferrer());
  params.transition_type = transition;
  params.is_renderer_initiated = navigation.IsRendererInitiated();
  params.initiator_origin = navigation.GetInitiatorOrigin();
  params.has_user_gesture = navigation.HasUserGesture();
  // As WebViewGuest::Navigate: a user agent the window was given.
  if (!contents.GetUserAgentOverride().ua_string_override.empty()) {
    params.override_user_agent =
        content::NavigationController::UA_OVERRIDE_TRUE;
  }
  VLOG(1) << "domicile: link tracking: " << url.possibly_invalid_spec()
          << " goes to " << without->possibly_invalid_spec() << " ("
          << AdBlockingModeName(mode) << ")";
  // Not now: a navigation started under this one's throttle would cancel
  // it from inside its own check.
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE,
      base::BindOnce(&NavigateAgain, contents.GetWeakPtr(), std::move(params)));
  return CANCEL_AND_IGNORE;
}

const char* LinkTrackingThrottle::GetNameForLogging() {
  return "DomicileLinkTrackingThrottle";
}

}  // namespace domicile
