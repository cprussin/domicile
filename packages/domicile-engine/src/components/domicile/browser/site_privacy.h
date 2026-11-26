// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_SITE_PRIVACY_H_
#define COMPONENTS_DOMICILE_BROWSER_SITE_PRIVACY_H_

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "components/domicile/browser/browser_profiles.h"

class GURL;
class PrefRegistrySimple;
class PrefService;

namespace domicile {

// Where a profile keeps how its pages block ads and trackers. See
// docs/architecture/AD-BLOCKING.md.
//
// - The profile's mode is the config's, in `domicile.ad_blocking.profile`,
//   which ApplyProtections sets on each profile and its off-the-record one.
// - A site's is in `domicile.ad_blocking.sites`, by PrivacySiteOf. A private
//   profile's is its off-the-record one's, so it goes with the profile's
//   last page.
//
// A page's, which a window may change too, is PagePrivacy's
// (page_privacy.h).

inline constexpr char kProfileAdBlockingPref[] = "domicile.ad_blocking.profile";
inline constexpr char kSiteAdBlockingPref[] = "domicile.ad_blocking.sites";
// Whether links to other sites lose their tracking (LinkTrackingThrottle),
// as the config has it. Off too wherever the page's ad blocking is Off.
inline constexpr char kRemoveLinkTrackingPref[] =
    "domicile.link_tracking.remove";
// Whether pages see the device's details a little off (DeviceDetailsHiding),
// as the config has it. Off too wherever the page's ad blocking is Off.
inline constexpr char kHideDeviceDetailsPref[] =
    "domicile.device_details.hide";

// The prefs above, on every profile.
void RegisterSitePrivacyPrefs(PrefRegistrySimple* registry);

// What the config and the prefs call each mode, and back.
std::string_view AdBlockingModeName(AdBlockingMode mode);
std::optional<AdBlockingMode> AdBlockingModeNamed(std::string_view name);

// The site a page's setting is kept for: its registrable domain, private
// registries included, as a request's third party is judged, or its host
// when it has none (an IP address, `localhost`). Empty for a page that is not
// http or https, which is never blocked.
std::string PrivacySiteOf(const GURL& page);

// Sets the profile's mode, as the config has it.
void SetProfileAdBlocking(PrefService& prefs, AdBlockingMode mode);
AdBlockingMode ProfileAdBlocking(const PrefService& prefs);

// The mode set for `site`, or none for the profile's. Setting none removes
// it.
std::optional<AdBlockingMode> SiteAdBlocking(const PrefService& prefs,
                                             std::string_view site);
void SetSiteAdBlocking(PrefService& prefs,
                       std::string_view site,
                       std::optional<AdBlockingMode> mode);

// Every site with its own mode, by site.
std::vector<std::pair<std::string, AdBlockingMode>> SitesWithOwnAdBlocking(
    const PrefService& prefs);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SITE_PRIVACY_H_
