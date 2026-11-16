// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_BROWSER_PROFILES_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_BROWSER_PROFILES_H_

#include <map>
#include <memory>
#include <optional>
#include <string>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/observer_list.h"
#include "base/observer_list_types.h"
#include "base/scoped_multi_source_observation.h"
#include "base/types/expected.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "components/domicile/browser/browser_profiles.h"
#include "components/domicile/browser/extension_installer.h"
#include "components/domicile/browser/private_pages.h"

class PrefRegistrySimple;
class ScopedProfileKeepAlive;

namespace content {
class BrowserContext;
}

namespace domicile {

// The desk's browser profiles as Chrome profiles. See
// docs/architecture/BROWSER-PROFILES.md.
//
// - The default profile is the shell's own profile, so the sign-ins a desk
//   had before profiles stay where they were.
// - Every other profile is one ProfileManager keeps in the user data
//   directory as `domicile-<id>`: ProfileManager takes only its direct
//   children. Loaded when the config names it, and kept loaded while it does.
// - A private profile's pages are the primary off-the-record profile of its
//   `domicile-<id>`, which holds the extensions it turns on and opens no page
//   itself. It ends with its last page, as private browsing does.
//
// Each Chrome profile has its own extensions, so a profile's extensions see
// only its own pages. And its own desk (DomicileWindowController), started by
// PostProfileInit like the shell's, so chrome.tabs in it lists only its own.
// Every profile's windows are listed together, by the shell's DeskWindows.
//
// The sites the user pins from a shell (PinSite) are kept in the shell's
// profile's prefs and go under the config's: the config wins.
//
// One per process, as the desk is. UI thread only.
class BrowserProfileRegistry final : public ProfileObserver {
 public:
  class Observer : public base::CheckedObserver {
   public:
    // The profiles changed: one was added, removed, renamed or recolored, the
    // default moved, or a site was pinned.
    virtual void OnBrowserProfilesChanged() = 0;
  };

  static BrowserProfileRegistry& Get();

  BrowserProfileRegistry(const BrowserProfileRegistry&) = delete;
  BrowserProfileRegistry& operator=(const BrowserProfileRegistry&) = delete;

  // The desk's profiles, from the compositor, for the shell in `shell`. Loads
  // each one, and closes the pages of any it no longer lists.
  void Configure(Profile& shell, BrowserProfiles profiles);

  // Every extension the desk's config names, their directories resolved. Each
  // profile gets the ones it turns on (ExtensionsFor).
  void SetExtensions(Profile& shell, ExtensionList all);

  // The desk's profiles, with the sites the user pinned under the config's
  // (WithPinnedSites): DefaultBrowserProfiles until the compositor sends
  // them.
  const BrowserProfiles& profiles() const { return profiles_; }

  // Whether `site` is one of the config's own sites, which the user cannot
  // pin elsewhere.
  bool IsConfigSite(const std::string& site) const;

  // Opens `site` in profile `profile` from now on, kept across restarts. The
  // default profile unpins it, as a site never maps to it. Says why not for
  // a site that is no key of the config's `browser.sites`, one the config's
  // sites name, or a profile the desk does not have. Pages already open stay
  // where they are.
  base::expected<void, std::string> PinSite(Profile& shell,
                                            const std::string& site,
                                            const std::string& profile);

  // The context profile `id`'s pages are made in, for the shell in `shell`.
  // Loads it if Configure's load has not finished, which blocks. Null for a
  // profile the desk does not have.
  Profile* ContextOf(Profile& shell, const std::string& id);

  // The id of the profile `context` is: the default profile for the shell's
  // own, `<id>` for `domicile-<id>`'s, whether or not the config still lists
  // it. Empty for any other, such as the shell's off-the-record profile.
  std::string IdOf(content::BrowserContext& context) const;

  // The profile whose desk lists `context`'s pages: the shell's, for any
  // browser profile's context; otherwise `context`'s original profile.
  Profile& HomeOf(content::BrowserContext& context) const;

  // A page was made in, or destroyed from, `context`, a private profile's.
  // The profile ends a task after its last page.
  void PrivatePageOpened(content::BrowserContext& context);
  void PrivatePageClosed(content::BrowserContext& context);

  void AddObserver(Observer* observer);
  void RemoveObserver(Observer* observer);

 private:
  friend class base::NoDestructor<BrowserProfileRegistry>;

  // One profile other than the default, once ProfileManager loaded it.
  struct Loaded {
    Loaded();
    Loaded(Loaded&&);
    Loaded& operator=(Loaded&&);
    ~Loaded();

    raw_ptr<Profile> profile = nullptr;
    // ProfileManager unloads a profile with no keep-alive. A desk's profile
    // has no Chrome window to hold one, so it holds its own.
    std::unique_ptr<ScopedProfileKeepAlive> keep_alive;
    // Its open private pages, for a private profile.
    std::unique_ptr<PrivatePages> private_pages;
    // The off-the-record profile EndPrivate is destroying, until it is.
    base::WeakPtr<Profile> ending;
  };

  BrowserProfileRegistry();
  ~BrowserProfileRegistry() override;

  // Sets the shell's profile. A desk has one shell, in one profile.
  void UseShell(Profile& shell);

  // Recomputes the profiles from the config's and the pins, and tells the
  // observers when that changed them.
  void Update();

  // Profile `id`'s `domicile-<id>`, loading it now if it is not yet.
  Profile* Load(const std::string& id);
  // Starts loading profile `id`'s `domicile-<id>`, without blocking.
  void StartLoading(const std::string& id);
  void OnLoaded(const std::string& id, Profile* profile);
  // Holds and watches `profile` as profile `id`'s, and installs its
  // extensions.
  void Adopt(const std::string& id, Profile& profile);

  // Installs into every loaded profile, the shell's included, the extensions
  // it turns on, once the config's extensions are known.
  void InstallExtensions();
  void InstallExtensionsOf(Profile& profile, const BrowserProfile& as);

  // Ends private profile `id`'s off-the-record profile; its last page closed.
  void EndPrivate(const std::string& id);

  // ProfileObserver:
  void OnProfileWillBeDestroyed(Profile* profile) override;

  raw_ptr<Profile> shell_ = nullptr;
  // The compositor's, as the config has them.
  BrowserProfiles config_;
  // The user's, from the shell's prefs once the shell is known.
  PinnedSites pinned_;
  // config_ with pinned_ (WithPinnedSites).
  BrowserProfiles profiles_;
  // The config's extensions, once SetExtensions has them.
  std::optional<ExtensionList> extensions_;
  // By id. Never the default profile, which is the shell's.
  std::map<std::string, Loaded> loaded_;
  base::ScopedMultiSourceObservation<Profile, ProfileObserver> observations_{
      this};
  base::ObserverList<Observer> observers_;
  base::WeakPtrFactory<BrowserProfileRegistry> weak_factory_{this};
};

// Registers the pref the sites the user pinned are kept in.
void RegisterBrowserProfilesPrefs(PrefRegistrySimple* registry);

// Has the control channel hand the compositor's `browser_profiles` to
// BrowserProfileRegistry, for the shell whose channel heard them. Once, from
// StartDesk, before a shell can bind a channel.
void StartBrowserProfiles();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_BROWSER_PROFILES_H_
