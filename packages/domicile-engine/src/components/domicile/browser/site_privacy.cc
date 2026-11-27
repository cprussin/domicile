// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/site_privacy.h"

#include <map>

#include "base/check.h"
#include "base/values.h"
#include "components/prefs/pref_registry_simple.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "url/gurl.h"

namespace domicile {

void RegisterSitePrivacyPrefs(PrefRegistrySimple* registry) {
  registry->RegisterStringPref(
      kProfileAdBlockingPref,
      std::string(AdBlockingModeName(AdBlockingMode::kStandard)));
  registry->RegisterDictionaryPref(kSiteAdBlockingPref);
  registry->RegisterBooleanPref(kRemoveLinkTrackingPref, true);
  registry->RegisterBooleanPref(kHideDeviceDetailsPref, true);
  registry->RegisterBooleanPref(kHideCookieBannersPref, true);
  registry->RegisterDictionaryPref(kSiteProtectionsPref);
}

std::string_view AdBlockingModeName(AdBlockingMode mode) {
  switch (mode) {
    case AdBlockingMode::kStandard:
      return "standard";
    case AdBlockingMode::kStrict:
      return "strict";
    case AdBlockingMode::kOff:
      return "off";
  }
}

std::optional<AdBlockingMode> AdBlockingModeNamed(std::string_view name) {
  for (const AdBlockingMode mode :
       {AdBlockingMode::kStandard, AdBlockingMode::kStrict,
        AdBlockingMode::kOff}) {
    if (AdBlockingModeName(mode) == name) {
      return mode;
    }
  }
  return std::nullopt;
}

std::string PrivacySiteOf(const GURL& page) {
  if (!page.SchemeIsHTTPOrHTTPS() || !page.has_host()) {
    return std::string();
  }
  std::string domain = net::registry_controlled_domains::GetDomainAndRegistry(
      page, net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES);
  return domain.empty() ? std::string(page.host()) : domain;
}

void SetProfileAdBlocking(PrefService& prefs, AdBlockingMode mode) {
  prefs.SetString(kProfileAdBlockingPref, std::string(AdBlockingModeName(mode)));
}

AdBlockingMode ProfileAdBlocking(const PrefService& prefs) {
  // The pref is only ever one of the names, and a profile's pages are checked
  // in its mode: a value that isn't is a fault.
  const std::optional<AdBlockingMode> mode =
      AdBlockingModeNamed(prefs.GetString(kProfileAdBlockingPref));
  CHECK(mode.has_value()) << kProfileAdBlockingPref << " is "
                          << prefs.GetString(kProfileAdBlockingPref);
  return *mode;
}

std::optional<AdBlockingMode> SiteAdBlocking(const PrefService& prefs,
                                             std::string_view site) {
  const std::string* name = prefs.GetDict(kSiteAdBlockingPref).FindString(site);
  if (name == nullptr) {
    return std::nullopt;
  }
  const std::optional<AdBlockingMode> mode = AdBlockingModeNamed(*name);
  CHECK(mode.has_value()) << kSiteAdBlockingPref << " has " << *name << " for "
                          << site;
  return mode;
}

void SetSiteAdBlocking(PrefService& prefs,
                       std::string_view site,
                       std::optional<AdBlockingMode> mode) {
  CHECK(!site.empty());
  ScopedDictPrefUpdate update(&prefs, kSiteAdBlockingPref);
  if (mode.has_value()) {
    update->Set(site, AdBlockingModeName(*mode));
  } else {
    update->Remove(site);
  }
}

std::string_view PageProtectionName(PageProtection protection) {
  switch (protection) {
    case PageProtection::kHideDeviceDetails:
      return "hide_device_details";
    case PageProtection::kRemoveTrackingFromLinks:
      return "remove_tracking_from_links";
    case PageProtection::kHideCookieBanners:
      return "hide_cookie_banners";
  }
}

std::optional<PageProtection> PageProtectionNamed(std::string_view name) {
  for (const PageProtection protection : kPageProtections) {
    if (PageProtectionName(protection) == name) {
      return protection;
    }
  }
  return std::nullopt;
}

bool ProfileProtection(const PrefService& prefs, PageProtection protection) {
  switch (protection) {
    case PageProtection::kHideDeviceDetails:
      return prefs.GetBoolean(kHideDeviceDetailsPref);
    case PageProtection::kRemoveTrackingFromLinks:
      return prefs.GetBoolean(kRemoveLinkTrackingPref);
    case PageProtection::kHideCookieBanners:
      return prefs.GetBoolean(kHideCookieBannersPref);
  }
}

std::optional<bool> SiteProtection(const PrefService& prefs,
                                   std::string_view site,
                                   PageProtection protection) {
  const base::DictValue* own =
      prefs.GetDict(kSiteProtectionsPref).FindDict(site);
  if (own == nullptr) {
    return std::nullopt;
  }
  return own->FindBool(PageProtectionName(protection));
}

void SetSiteProtection(PrefService& prefs,
                       std::string_view site,
                       PageProtection protection,
                       std::optional<bool> on) {
  CHECK(!site.empty());
  ScopedDictPrefUpdate update(&prefs, kSiteProtectionsPref);
  base::DictValue* own = update->EnsureDict(site);
  if (on.has_value()) {
    own->Set(PageProtectionName(protection), *on);
  } else {
    own->Remove(PageProtectionName(protection));
  }
  // A site with nothing of its own isn't kept, so it isn't listed.
  if (own->empty()) {
    update->Remove(site);
  }
}

SitePrivacySettings::SitePrivacySettings() = default;
SitePrivacySettings::SitePrivacySettings(const SitePrivacySettings&) = default;
SitePrivacySettings& SitePrivacySettings::operator=(
    const SitePrivacySettings&) = default;
SitePrivacySettings::~SitePrivacySettings() = default;

std::vector<std::pair<std::string, SitePrivacySettings>> SitesWithOwnPrivacy(
    const PrefService& prefs) {
  // By site: a dict iterates in key order, and a map keeps it.
  std::map<std::string, SitePrivacySettings> sites;
  for (const auto [site, name] : prefs.GetDict(kSiteAdBlockingPref)) {
    const std::optional<AdBlockingMode> mode =
        name.is_string() ? AdBlockingModeNamed(name.GetString()) : std::nullopt;
    CHECK(mode.has_value()) << kSiteAdBlockingPref << " has " << name
                            << " for " << site;
    sites[site].block_ads_and_trackers = mode;
  }
  for (const auto [site, own] : prefs.GetDict(kSiteProtectionsPref)) {
    CHECK(own.is_dict()) << kSiteProtectionsPref << " has " << own << " for "
                         << site;
    for (const PageProtection protection : kPageProtections) {
      if (const std::optional<bool> on =
              own.GetDict().FindBool(PageProtectionName(protection))) {
        sites[site].protections.emplace_back(protection, *on);
      }
    }
  }
  return {sites.begin(), sites.end()};
}

}  // namespace domicile
