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
#include "ui/base/page_transition_types.h"

class GURL;

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
  // The extension ids it turns on; nothing turns on all of them, or none for
  // a private profile.
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

// The profile `url` opens in: the most specific of `profiles.sites` that
// matches it, else the default profile. A host and path is more specific than
// a host, a host than `*.host`, and a longer one than a shorter. Only web
// addresses are in sites; any other opens in the default profile.
const std::string& ProfileForUrl(const BrowserProfiles& profiles,
                                 const GURL& url);

// The profile a page in profile `page_profile` moves to as the user takes it
// from `from` to `to`, or nothing when it stays. It moves when routing puts
// the two addresses in different profiles and `to`'s is not the page's own:
// a page moved by hand stays where it was put while it stays on one site.
std::optional<std::string> RouteNavigation(const BrowserProfiles& profiles,
                                           const std::string& page_profile,
                                           const GURL& from,
                                           const GURL& to);

// Whether a window's navigation is one the user took, which may move its page
// to the profile of the site it goes to (RouteNavigation): a link they
// clicked, the address bar, the shell's own, or a step back or forward. In
// the main frame, to a new document. Not a reload, a POST, whose body would
// not survive the move, or the page's own script with no click behind it.
bool IsUserNavigation(bool main_frame,
                      bool same_document,
                      bool renderer_initiated,
                      bool user_gesture,
                      bool post,
                      ui::PageTransition transition);

// The extensions of `all` that `profile` turns on, with every setting. A
// private profile's are allowed into its private pages.
// `unpacked_id` gives the id of each of `all.unpacked`.
ExtensionList ExtensionsFor(
    const BrowserProfile& profile,
    const ExtensionList& all,
    base::FunctionRef<std::string(const std::string&)> unpacked_id);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROWSER_PROFILES_H_
