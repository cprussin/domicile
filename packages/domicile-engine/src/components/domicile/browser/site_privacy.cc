// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/site_privacy.h"

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

}  // namespace domicile
