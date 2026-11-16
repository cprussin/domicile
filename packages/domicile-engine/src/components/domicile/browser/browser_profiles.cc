// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/browser_profiles.h"

#include <algorithm>
#include <set>
#include <utility>

#include "base/containers/contains.h"

namespace domicile {
namespace {

bool IsProfileId(std::string_view id) {
  return !id.empty() && std::ranges::all_of(id, [](char c) {
    return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';
  });
}

// A list of strings, or nothing when `value` is anything else.
std::optional<std::vector<std::string>> Strings(const base::ListValue& value) {
  std::vector<std::string> strings;
  for (const base::Value& item : value) {
    if (!item.is_string()) {
      return std::nullopt;
    }
    strings.push_back(item.GetString());
  }
  return strings;
}

std::optional<BrowserProfile> ParseProfile(const base::Value& value) {
  const base::DictValue* dict = value.GetIfDict();
  if (dict == nullptr) {
    return std::nullopt;
  }
  const std::string* id = dict->FindString("id");
  const std::string* name = dict->FindString("name");
  const std::string* color = dict->FindString("color");
  const std::optional<bool> is_private = dict->FindBool("private");
  if (id == nullptr || !IsProfileId(*id) || name == nullptr ||
      color == nullptr || !is_private.has_value()) {
    return std::nullopt;
  }
  BrowserProfile profile{
      .id = *id, .name = *name, .color = *color, .is_private = *is_private};
  const base::Value* extensions = dict->Find("extensions");
  if (extensions != nullptr && !extensions->is_none()) {
    if (!extensions->is_list()) {
      return std::nullopt;
    }
    profile.extensions = Strings(extensions->GetList());
    if (!profile.extensions.has_value()) {
      return std::nullopt;
    }
  }
  return profile;
}

// Whether `profiles` agrees with itself, as the config checks.
bool Consistent(const BrowserProfiles& profiles) {
  std::set<std::string> ids;
  for (const BrowserProfile& profile : profiles.profiles) {
    if (!ids.insert(profile.id).second) {
      return false;
    }
  }
  const BrowserProfile* fallback = profiles.Find(profiles.default_profile);
  const BrowserProfile* fallback_private =
      profiles.Find(profiles.default_private_profile);
  return fallback != nullptr && !fallback->is_private &&
         fallback_private != nullptr && fallback_private->is_private &&
         std::ranges::all_of(profiles.sites, [&profiles](const auto& site) {
           return profiles.Find(site.second) != nullptr &&
                  site.second != profiles.default_profile;
         });
}

}  // namespace

BrowserProfiles::BrowserProfiles() = default;
BrowserProfiles::BrowserProfiles(const BrowserProfiles&) = default;
BrowserProfiles& BrowserProfiles::operator=(const BrowserProfiles&) = default;
BrowserProfiles::~BrowserProfiles() = default;

const BrowserProfile* BrowserProfiles::Find(std::string_view id) const {
  auto found = std::ranges::find(profiles, id, &BrowserProfile::id);
  return found == profiles.end() ? nullptr : &*found;
}

BrowserProfiles DefaultBrowserProfiles() {
  BrowserProfiles profiles;
  profiles.profiles = {
      BrowserProfile{.id = "default", .name = "Default", .color = "#0d9488"},
      BrowserProfile{.id = "private",
                     .name = "Private",
                     .color = "#a78bfa",
                     .is_private = true},
  };
  profiles.default_profile = "default";
  profiles.default_private_profile = "private";
  return profiles;
}

std::optional<BrowserProfiles> ParseBrowserProfiles(
    const base::DictValue& message) {
  const base::ListValue* list = message.FindList("profiles");
  const std::string* fallback = message.FindString("default_profile");
  const std::string* fallback_private =
      message.FindString("default_private_profile");
  const base::DictValue* sites = message.FindDict("sites");
  if (list == nullptr || fallback == nullptr || fallback_private == nullptr ||
      sites == nullptr) {
    return std::nullopt;
  }
  BrowserProfiles profiles;
  for (const base::Value& item : *list) {
    std::optional<BrowserProfile> profile = ParseProfile(item);
    if (!profile.has_value()) {
      return std::nullopt;
    }
    profiles.profiles.push_back(std::move(*profile));
  }
  for (const auto [site, id] : *sites) {
    if (!id.is_string()) {
      return std::nullopt;
    }
    profiles.sites[site] = id.GetString();
  }
  profiles.default_profile = *fallback;
  profiles.default_private_profile = *fallback_private;
  if (!Consistent(profiles)) {
    return std::nullopt;
  }
  return profiles;
}

ExtensionList ExtensionsFor(
    const BrowserProfile& profile,
    const ExtensionList& all,
    base::FunctionRef<std::string(const std::string&)> unpacked_id) {
  const auto on = [&profile](const std::string& id) {
    return !profile.extensions.has_value() ||
           base::Contains(*profile.extensions, id);
  };
  ExtensionList chosen{.settings = all.settings};
  std::vector<std::string> ids;
  for (const std::string& id : all.web_store) {
    if (on(id)) {
      chosen.web_store.push_back(id);
      ids.push_back(id);
    }
  }
  for (const std::string& directory : all.unpacked) {
    std::string id = unpacked_id(directory);
    if (on(id)) {
      chosen.unpacked.push_back(directory);
      ids.push_back(std::move(id));
    }
  }
  // A private profile's pages are off the record, where an extension runs
  // only when allowed to. The profile turning it on is that permission.
  if (profile.is_private) {
    for (const std::string& id : ids) {
      chosen.settings[id].in_private = true;
    }
  }
  return chosen;
}

}  // namespace domicile
