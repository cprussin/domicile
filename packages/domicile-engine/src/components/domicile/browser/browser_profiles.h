// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_BROWSER_PROFILES_H_
#define COMPONENTS_DOMICILE_BROWSER_BROWSER_PROFILES_H_

#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/functional/function_ref.h"
#include "base/values.h"
#include "components/domicile/browser/extension_installer.h"

namespace domicile {

// One browser profile: a set of sign-ins, site data and extensions. See
// docs/architecture/BROWSER-PROFILES.md.
struct BrowserProfile {
  friend bool operator==(const BrowserProfile&,
                         const BrowserProfile&) = default;

  // Lowercase letters, digits and `-`, so it names a directory.
  std::string id;
  std::string name;
  // `#rrggbb`.
  std::string color;
  // Keeps nothing past its last page.
  bool is_private = false;
  // The extension ids it turns on; nothing turns on all of them.
  std::optional<std::vector<std::string>> extensions;
};

// The desk's browser profiles: the config's `browser`, as the compositor's
// `browser_profiles` message carries it.
struct BrowserProfiles {
  BrowserProfiles();
  BrowserProfiles(const BrowserProfiles&);
  BrowserProfiles& operator=(const BrowserProfiles&);
  ~BrowserProfiles();
  friend bool operator==(const BrowserProfiles&,
                         const BrowserProfiles&) = default;

  // Profile `id`, or null.
  const BrowserProfile* Find(std::string_view id) const;

  std::vector<BrowserProfile> profiles;
  // Where an unlisted site opens. Never private.
  std::string default_profile;
  // Where a new private window opens. Always private.
  std::string default_private_profile;
  // Profile ids by site: a host, `*.host`, or a host and path.
  std::map<std::string, std::string> sites;
};

// The profiles of a desk whose compositor sends none: `default` and
// `private`, as the config's own defaults.
BrowserProfiles DefaultBrowserProfiles();

// Reads a `browser_profiles` message:
//
//   {"profiles": [{"id": "work", "name": "Work", "color": "#d97706",
//                  "private": false, "extensions": ["<id>", ...] | null}],
//    "default_profile": "personal", "default_private_profile": "private",
//    "sites": {"github.com/acme": "work"}}
//
// Nothing when malformed, or when it contradicts itself as the config refuses
// to: a default that is no profile or is private, a default private profile
// that is not private, a site in no profile or in the default one, an id that
// is no directory name, or two profiles with one id.
std::optional<BrowserProfiles> ParseBrowserProfiles(
    const base::DictValue& message);

// The extensions of `all` that `profile` turns on, with every setting.
// `unpacked_id` gives the id of each of `all.unpacked`.
ExtensionList ExtensionsFor(
    const BrowserProfile& profile,
    const ExtensionList& all,
    base::FunctionRef<std::string(const std::string&)> unpacked_id);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROWSER_PROFILES_H_
