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
//
// Each protection beside ad blocking (PageProtection) is on or off the same
// way: the profile's, as the config has it, else a site's, in
// `domicile.privacy.sites`, else a window's. All are off where the page's ad
// blocking is Off, which a shield shows as protections off.

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
// Whether pages' cookie banners are hidden, and the scripts that show them
// blocked, with the cookie banner lists (AdBlocker), as the config has it.
// Off too wherever the page's ad blocking is Off.
inline constexpr char kHideCookieBannersPref[] = "domicile.cookie_banners.hide";

// A site's protections, by PageProtectionName, each true or false: a
// dictionary of dictionaries, by PrivacySiteOf.
inline constexpr char kSiteProtectionsPref[] = "domicile.privacy.sites";

// The protections a shield turns on and off one by one, beside ad blocking.
enum class PageProtection {
  kHideDeviceDetails,
  kRemoveTrackingFromLinks,
  kHideCookieBanners,
};

inline constexpr PageProtection kPageProtections[] = {
    PageProtection::kHideDeviceDetails,
    PageProtection::kRemoveTrackingFromLinks,
    PageProtection::kHideCookieBanners,
};

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

// What the config and the prefs call each protection (its config key, such
// as `hide_device_details`), and back.
std::string_view PageProtectionName(PageProtection protection);
std::optional<PageProtection> PageProtectionNamed(std::string_view name);

// Whether the profile has `protection` on, as the config has it.
bool ProfileProtection(const PrefService& prefs, PageProtection protection);

// Whether `site` has `protection` on or off of its own, or none for the
// profile's. Setting none removes it.
std::optional<bool> SiteProtection(const PrefService& prefs,
                                   std::string_view site,
                                   PageProtection protection);
void SetSiteProtection(PrefService& prefs,
                       std::string_view site,
                       PageProtection protection,
                       std::optional<bool> on);

// What one site changed from its profile's.
struct SitePrivacySettings {
  SitePrivacySettings();
  SitePrivacySettings(const SitePrivacySettings&);
  SitePrivacySettings& operator=(const SitePrivacySettings&);
  ~SitePrivacySettings();

  friend bool operator==(const SitePrivacySettings&,
                         const SitePrivacySettings&) = default;

  std::optional<AdBlockingMode> block_ads_and_trackers;
  // In kPageProtections order, those the site has of its own.
  std::vector<std::pair<PageProtection, bool>> protections;
};

// Every site with a mode or a protection of its own, by site.
std::vector<std::pair<std::string, SitePrivacySettings>> SitesWithOwnPrivacy(
    const PrefService& prefs);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SITE_PRIVACY_H_
