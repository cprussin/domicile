// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_browser_profiles.h"

#include <algorithm>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/one_shot_event.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/bind_post_task.h"
#include "base/task/sequenced_task_runner.h"
#include "base/types/expected.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/domicile/domicile_ad_blocking.h"
#include "chrome/browser/domicile/domicile_extension_installer.h"
#include "chrome/browser/domicile/domicile_extension_settings.h"
#include "chrome/browser/extensions/extension_service.h"
#include "chrome/browser/profiles/keep_alive/profile_keep_alive_types.h"
#include "chrome/browser/profiles/keep_alive/scoped_profile_keep_alive.h"
#include "chrome/browser/profiles/profile_destroyer.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/common/pref_names.h"
#include "components/domicile/browser/control_channel.h"
#include "components/domicile/browser/protection_settings.h"
#include "components/domicile/browser/site_privacy.h"
#include "components/prefs/pref_registry_simple.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/render_frame_host.h"
#include "extensions/browser/disable_reason.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/browser/extension_registrar.h"
#include "extensions/browser/extension_system.h"
#include "extensions/browser/pending_extension_manager.h"
#include "extensions/browser/uninstall_reason.h"
#include "extensions/common/extension.h"
#include "extensions/common/extension_urls.h"
#include "extensions/common/manifest.h"
#include "extensions/common/mojom/manifest.mojom-shared.h"

namespace domicile {
namespace {

// The sites the user pinned, in the shell's profile: profile ids by site.
constexpr char kPinnedSitesPref[] = "domicile.browser_profiles.pinned_sites";

// The config's extensions each Chrome profile has switched to its
// DefaultSwitch, so the user's later switch is theirs to keep.
constexpr char kSwitchedPref[] =
    "domicile.browser_profiles.switched_extensions";

// A profile's directory in the user data directory is this and its id.
constexpr char kDirectoryPrefix[] = "domicile-";

base::FilePath DirectoryOf(const std::string& id) {
  return g_browser_process->profile_manager()->user_data_dir().AppendASCII(
      base::StrCat({kDirectoryPrefix, id}));
}

// The id `profile` keeps a browser profile's pages for, or nothing for a
// profile that keeps none.
std::optional<std::string> IdOfDirectory(const Profile& profile) {
  const std::string name = profile.GetPath().BaseName().AsUTF8Unsafe();
  if (!base::StartsWith(name, kDirectoryPrefix)) {
    return std::nullopt;
  }
  return name.substr(sizeof(kDirectoryPrefix) - 1);
}

// The compositor's `browser_profiles`, for the shell frame whose channel heard
// them. A shell gone meanwhile is a reload; its next channel hears them again.
void ConfigureFor(const Page& page, const BrowserProfiles& profiles) {
  content::RenderFrameHost* frame =
      content::RenderFrameHost::FromID(page.process, page.frame);
  if (frame == nullptr) {
    LOG(WARNING) << "domicile: the desk's browser profiles arrived for a "
                    "shell page that is gone; the next one hears them.";
    return;
  }
  BrowserProfileRegistry::Get().Configure(
      *Profile::FromBrowserContext(frame->GetBrowserContext())
           ->GetOriginalProfile(),
      profiles);
}

// `extension` as another profile installs it, or nothing for one the user
// did not install: a component, an app, or one from elsewhere, such as policy
// or a .crx dropped in. The config's are left to the config.
std::optional<UserExtension> AsUserExtension(
    const extensions::Extension& extension) {
  if (!extension.is_extension() ||
      extensions::Manifest::IsComponentLocation(extension.location())) {
    return std::nullopt;
  }
  if (extension.location() == extensions::mojom::ManifestLocation::kUnpacked) {
    return UserExtension{.id = extension.id(),
                         .unpacked = extension.path().AsUTF8Unsafe()};
  }
  if (extension.from_webstore()) {
    return UserExtension{.id = extension.id()};
  }
  return std::nullopt;
}

}  // namespace

BrowserProfileRegistry::Loaded::Loaded() = default;
BrowserProfileRegistry::Loaded::Loaded(Loaded&&) = default;
BrowserProfileRegistry::Loaded& BrowserProfileRegistry::Loaded::operator=(
    Loaded&&) = default;
BrowserProfileRegistry::Loaded::~Loaded() = default;

// static
BrowserProfileRegistry& BrowserProfileRegistry::Get() {
  static base::NoDestructor<BrowserProfileRegistry> registry;
  return *registry;
}

BrowserProfileRegistry::BrowserProfileRegistry()
    : config_(DefaultBrowserProfiles()), profiles_(DefaultBrowserProfiles()) {}

BrowserProfileRegistry::~BrowserProfileRegistry() = default;

void BrowserProfileRegistry::Configure(Profile& shell,
                                       BrowserProfiles profiles) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  UseShell(shell);
  // A profile the config no longer lists unloads once nothing else holds it,
  // and its pages close with it (DeskWindows). So does one that became the
  // default, whose pages are the shell's profile's from now on.
  for (auto it = loaded_.begin(); it != loaded_.end();) {
    const BrowserProfile* still = profiles.Find(it->first);
    if (still != nullptr && it->first != profiles.default_profile) {
      ++it;
      continue;
    }
    LOG(INFO) << "domicile: browser profile " << it->first
              << " is no longer in the desk's config; its pages close.";
    observations_.RemoveObservation(it->second.profile);
    it = loaded_.erase(it);
  }
  config_ = std::move(profiles);
  // Loads and installs before telling the observers, so a page they open in
  // a new profile finds it.
  const BrowserProfiles before = profiles_;
  profiles_ = WithPinnedSites(config_, pinned_);
  for (const BrowserProfile& profile : profiles_.profiles) {
    if (profile.id != profiles_.default_profile &&
        !loaded_.contains(profile.id)) {
      StartLoading(profile.id);
    }
  }
  InstallExtensions();
  Protect();
  AdBlocking::Get().Configure(config_.block_lists, config_.block_rules,
                              config_.cookie_banner_lists);
  if (profiles_ != before) {
    for (Observer& observer : observers_) {
      observer.OnBrowserProfilesChanged();
    }
  }
}

bool BrowserProfileRegistry::IsConfigSite(const std::string& site) const {
  return config_.sites.contains(site);
}

base::expected<void, std::string> BrowserProfileRegistry::PinSite(
    Profile& shell,
    const std::string& site,
    const std::string& profile) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  UseShell(shell);
  if (!IsSiteKey(site)) {
    return base::unexpected(base::StrCat(
        {"\"", site,
         "\" is no site: a lowercase host, *. and a host, or a host and a "
         "path"}));
  }
  if (IsConfigSite(site)) {
    return base::unexpected(base::StrCat(
        {"the desk's config opens ", site, " in profile ",
         config_.sites.at(site), "; only the config changes that"}));
  }
  if (config_.Find(profile) == nullptr) {
    return base::unexpected(
        base::StrCat({"the desk has no browser profile \"", profile, "\""}));
  }
  {
    ScopedDictPrefUpdate pinned(shell.GetPrefs(), kPinnedSitesPref);
    if (profile == config_.default_profile) {
      pinned->Remove(site);
    } else {
      pinned->Set(site, profile);
    }
  }
  if (profile == config_.default_profile) {
    pinned_.erase(site);
  } else {
    pinned_[site] = profile;
  }
  LOG(INFO) << "domicile: " << site << " opens in browser profile " << profile
            << " from now on.";
  Update();
  return base::ok();
}

void BrowserProfileRegistry::Update() {
  BrowserProfiles profiles = WithPinnedSites(config_, pinned_);
  if (profiles == profiles_) {
    return;
  }
  profiles_ = std::move(profiles);
  for (Observer& observer : observers_) {
    observer.OnBrowserProfilesChanged();
  }
}

void BrowserProfileRegistry::SetExtensions(
    Profile& shell,
    ExtensionList all,
    std::map<std::string, std::string> unpacked_ids) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  UseShell(shell);
  extensions_ = std::move(all);
  unpacked_ids_ = std::move(unpacked_ids);
  InstallExtensions();
}

Profile* BrowserProfileRegistry::ContextOf(Profile& shell,
                                           const std::string& id) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  UseShell(shell);
  if (id == profiles_.default_profile) {
    return &shell;
  }
  const BrowserProfile* profile = profiles_.Find(id);
  if (profile == nullptr) {
    return nullptr;
  }
  Profile* home = Load(id);
  if (home == nullptr || !profile->is_private) {
    return home;
  }
  Loaded& loaded = loaded_.at(id);
  if (loaded.ending) {
    // Still waiting on its renderers. A page made in it would be destroyed
    // with it, so finish it now and start a new one.
    ProfileDestroyer::DestroyOTRProfileImmediately(loaded.ending.get());
  }
  if (home->HasPrimaryOTRProfile()) {
    return home->GetPrimaryOTRProfile(/*create_if_needed=*/false);
  }
  // A new one, made with Chrome's defaults: Configure only protects the
  // ones that are already open.
  Profile* otr = home->GetPrimaryOTRProfile(/*create_if_needed=*/true);
  VLOG(1) << "domicile: browser profile " << profile->id
          << " protections applied to its new off-the-record profile.";
  ApplyProtections(*otr->GetPrefs(), profile->protections);
  return otr;
}

void BrowserProfileRegistry::WhenLoaded(Profile& shell,
                                        const std::string& id,
                                        base::OnceClosure ready) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  UseShell(shell);
  if (id == profiles_.default_profile || profiles_.Find(id) == nullptr ||
      loaded_.contains(id)) {
    std::move(ready).Run();
    return;
  }
  std::vector<base::OnceClosure>& waiting = waiting_[id];
  waiting.push_back(std::move(ready));
  if (waiting.size() == 1) {
    // ProfileManager answers every load of one directory, so a second start
    // while Configure's is under way only adds an answer.
    StartLoading(id);
  }
}

std::string BrowserProfileRegistry::IdOf(
    content::BrowserContext& context) const {
  Profile* profile = Profile::FromBrowserContext(&context);
  Profile* original = profile->GetOriginalProfile();
  if (std::optional<std::string> id = IdOfDirectory(*original)) {
    return *id;
  }
  // The shell's off-the-record profile is no profile's. Nothing opens there
  // any more, private pages included.
  return profile->IsOffTheRecord() ? std::string() : profiles_.default_profile;
}

Profile& BrowserProfileRegistry::HomeOf(
    content::BrowserContext& context) const {
  Profile* original =
      Profile::FromBrowserContext(&context)->GetOriginalProfile();
  if (shell_ != nullptr && IdOfDirectory(*original).has_value()) {
    return *shell_;
  }
  return *original;
}

void BrowserProfileRegistry::PrivatePageOpened(
    content::BrowserContext& context) {
  const std::string id = IdOf(context);
  auto loaded = loaded_.find(id);
  if (loaded == loaded_.end()) {
    // A page made in an off-the-record profile no private profile owns.
    // Nothing ends that profile, so its storage would outlive the page.
    LOG(ERROR) << "domicile: a private page opened in an off-the-record "
                  "profile that is no private profile's (\""
               << id << "\"). Its storage stays until the engine exits.";
    return;
  }
  if (!loaded->second.private_pages) {
    loaded->second.private_pages = std::make_unique<PrivatePages>(
        base::BindRepeating(&BrowserProfileRegistry::EndPrivate,
                            weak_factory_.GetWeakPtr(), id));
  }
  loaded->second.private_pages->Opened();
}

void BrowserProfileRegistry::PrivatePageClosed(
    content::BrowserContext& context) {
  auto loaded = loaded_.find(IdOf(context));
  if (loaded != loaded_.end() && loaded->second.private_pages) {
    loaded->second.private_pages->Closed();
  }
}

void BrowserProfileRegistry::AddObserver(Observer* observer) {
  observers_.AddObserver(observer);
}

void BrowserProfileRegistry::RemoveObserver(Observer* observer) {
  observers_.RemoveObserver(observer);
}

void BrowserProfileRegistry::UseShell(Profile& shell) {
  CHECK(!shell.IsOffTheRecord());
  CHECK(!IdOfDirectory(shell).has_value())
      << "a shell runs in browser profile " << shell.GetPath();
  if (shell_ == &shell) {
    return;
  }
  CHECK(!shell_) << "a second shell profile, " << shell.GetPath() << ", after "
                 << shell_->GetPath();
  shell_ = &shell;
  observations_.AddObservation(&shell);
  for (const auto [site, profile] :
       shell.GetPrefs()->GetDict(kPinnedSitesPref)) {
    // Written only by PinSite. Anything else was edited by hand, so it says
    // so and leaves the rest.
    if (!profile.is_string() || !IsSiteKey(site)) {
      LOG(ERROR) << "domicile: the pinned site \"" << site
                 << "\" in the shell's prefs is no site and profile id; it "
                    "is left out.";
      continue;
    }
    pinned_[site] = profile.GetString();
  }
  Update();
  // Before the compositor says, and for a host with no config, which never
  // does: the default protections.
  Protect();
  // Chrome asks which profile to start in once there are two. A desk's
  // profiles are not Chrome's to pick between: the shell's is the one it
  // starts.
  g_browser_process->local_state()->SetBoolean(
      prefs::kBrowserShowProfilePickerOnStartup, false);
}

Profile* BrowserProfileRegistry::Load(const std::string& id) {
  if (auto loaded = loaded_.find(id); loaded != loaded_.end()) {
    return loaded->second.profile;
  }
  // A page that did not wait for WhenLoaded. This blocks the UI thread on
  // the disk, which DCHECK builds refuse.
  LOG(ERROR) << "domicile: browser profile " << id
             << " was wanted before it loaded; loading it now blocks.";
  Profile* profile =
      g_browser_process->profile_manager()->GetProfile(DirectoryOf(id));
  if (profile == nullptr) {
    LOG(ERROR) << "domicile: browser profile " << id << " would not load from "
               << DirectoryOf(id) << ".";
    return nullptr;
  }
  Adopt(id, *profile);
  return profile;
}

void BrowserProfileRegistry::StartLoading(const std::string& id) {
  g_browser_process->profile_manager()->CreateProfileAsync(
      DirectoryOf(id), base::BindOnce(&BrowserProfileRegistry::OnLoaded,
                                      weak_factory_.GetWeakPtr(), id));
}

void BrowserProfileRegistry::OnLoaded(const std::string& id, Profile* profile) {
  // Runs what waited, after the profile is adopted or not: each then makes
  // its page, or falls back as ContextOf does for a profile that would not
  // load.
  std::vector<base::OnceClosure> waiting;
  if (auto found = waiting_.find(id); found != waiting_.end()) {
    waiting = std::move(found->second);
    waiting_.erase(found);
  }
  if (profile == nullptr) {
    LOG(ERROR) << "domicile: browser profile " << id << " would not load from "
               << DirectoryOf(id) << ".";
  } else if (!loaded_.contains(id) && profiles_.Find(id) != nullptr &&
             id != profiles_.default_profile) {
    // Not when loaded already by a page that could not wait, or no longer
    // configured.
    Adopt(id, *profile);
  }
  for (base::OnceClosure& ready : waiting) {
    std::move(ready).Run();
  }
}

void BrowserProfileRegistry::Adopt(const std::string& id, Profile& profile) {
  Loaded& loaded = loaded_[id];
  loaded.profile = &profile;
  loaded.keep_alive = std::make_unique<ScopedProfileKeepAlive>(
      &profile, ProfileKeepAliveOrigin::kBrowserWindow);
  if (!observations_.IsObservingSource(&profile)) {
    observations_.AddObservation(&profile);
  }
  LOG(INFO) << "domicile: loaded browser profile " << id << ".";
  ProtectOne(profile, *profiles_.Find(id));
  if (extensions_.has_value()) {
    InstallExtensionsOf(profile, *profiles_.Find(id));
  }
}

void BrowserProfileRegistry::Protect() {
  if (shell_ != nullptr) {
    ProtectOne(*shell_, *profiles_.Find(profiles_.default_profile));
  }
  for (auto& [id, loaded] : loaded_) {
    ProtectOne(*loaded.profile, *profiles_.Find(id));
  }
}

void BrowserProfileRegistry::ProtectOne(Profile& profile,
                                        const BrowserProfile& config) {
  const BrowserProtections& protections = config.protections;
  VLOG(1) << "domicile: browser profile " << config.id
          << " protections:" << " third-party cookies "
          << (protections.block_third_party_cookies ? "blocked" : "allowed")
          << ", Global Privacy Control "
          << (protections.global_privacy_control ? "on" : "off")
          << ", local IP address "
          << (protections.hide_local_ip_address ? "hidden" : "shown")
          << ", links' tracking "
          << (protections.remove_tracking_from_links ? "removed" : "kept")
          << ", device details "
          << (protections.hide_device_details ? "hidden" : "shown")
          << ", cookie banners "
          << (protections.hide_cookie_banners ? "hidden" : "shown")
          << (profile.HasPrimaryOTRProfile() ? ", and its off-the-record one"
                                             : "")
          << ".";
  ApplyProtections(*profile.GetPrefs(), config.protections);
  if (profile.HasPrimaryOTRProfile()) {
    ApplyProtections(
        *profile.GetPrimaryOTRProfile(/*create_if_needed=*/false)->GetPrefs(),
        config.protections);
  }
}

void BrowserProfileRegistry::InstallExtensions() {
  if (!extensions_.has_value() || shell_ == nullptr) {
    return;
  }
  InstallExtensionsOf(*shell_, *profiles_.Find(profiles_.default_profile));
  for (auto& [id, loaded] : loaded_) {
    InstallExtensionsOf(*loaded.profile, *profiles_.Find(id));
  }
}

void BrowserProfileRegistry::InstallExtensionsOf(Profile& profile,
                                                 const BrowserProfile& as) {
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(&profile);
  if (!extension_registries_.IsObservingSource(registry)) {
    extension_registries_.AddObservation(registry);
  }
  ReconcileConfigExtensions(
      profile.GetWeakPtr(),
      ExtensionsFor(as, *extensions_, [this](const std::string& directory) {
        // As the unpacked installer names it: by its manifest's key, else its
        // resolved path (InstallExtensionsInto found both).
        auto found = unpacked_ids_.find(directory);
        CHECK(found != unpacked_ids_.end())
            << "no id for unpacked extension " << directory;
        return found->second;
      }));
  // The ones installed already. Each still installing is switched as it
  // installs (OnExtensionInstalled).
  extensions::ExtensionSystem::Get(&profile)->ready().Post(
      FROM_HERE,
      base::BindOnce(&BrowserProfileRegistry::SwitchExtensions,
                     weak_factory_.GetWeakPtr(), profile.GetWeakPtr()));
}

std::vector<std::string> BrowserProfileRegistry::ConfigExtensionIds() const {
  std::vector<std::string> ids;
  if (!extensions_.has_value()) {
    return ids;
  }
  ids = extensions_->web_store;
  for (const std::string& directory : extensions_->unpacked) {
    auto found = unpacked_ids_.find(directory);
    CHECK(found != unpacked_ids_.end())
        << "no id for unpacked extension " << directory;
    ids.push_back(found->second);
  }
  return ids;
}

const BrowserProfile* BrowserProfileRegistry::AsBrowserProfile(
    Profile& profile) const {
  if (&profile == shell_) {
    return profiles_.Find(profiles_.default_profile);
  }
  const std::optional<std::string> id = IdOfDirectory(profile);
  return id.has_value() ? profiles_.Find(*id) : nullptr;
}

Profile* BrowserProfileRegistry::ExtensionsProfileOf(const std::string& id) {
  if (id == profiles_.default_profile) {
    return shell_;
  }
  auto loaded = loaded_.find(id);
  return loaded == loaded_.end() ? nullptr : loaded->second.profile.get();
}

void BrowserProfileRegistry::SwitchExtensions(base::WeakPtr<Profile> profile) {
  if (!profile) {
    return;
  }
  // Its extension system is ready now, so it takes the extensions the user
  // installed elsewhere, and gives its own to the others.
  MirrorUserExtensions();
  const BrowserProfile* as = AsBrowserProfile(*profile);
  if (as == nullptr) {
    return;
  }
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(profile.get());
  // A setting changed while it loaded reached only the profiles ready then,
  // and the copies it loaded from disk have the settings they last had.
  if (shell_ != nullptr && profile.get() != shell_) {
    for (const scoped_refptr<const extensions::Extension>& extension :
         registry->GenerateInstalledExtensionsSet()) {
      TakeUpTheShellsSettings(*profile, *extension);
    }
  }
  for (const std::string& id : ConfigExtensionIds()) {
    const extensions::Extension* extension =
        registry->GetInstalledExtension(id);
    if (extension != nullptr) {
      // Chrome switched it off as it loaded if it was never granted them.
      GrantPermissionsOf(*profile, *extension);
      SwitchExtension(*profile, *as, id, /*installed_now=*/false);
    }
  }
  // Those switched while it loaded.
  if (auto pending = pending_switches_.find(as->id);
      pending != pending_switches_.end()) {
    std::vector<std::string> asked;
    for (const auto& [id, on] : pending->second) {
      if (registry->GetInstalledExtension(id) != nullptr) {
        asked.push_back(id);
      }
    }
    for (const std::string& id : asked) {
      SwitchExtension(*profile, *as, id, /*installed_now=*/false);
    }
  }
}

void BrowserProfileRegistry::SwitchExtension(Profile& profile,
                                             const BrowserProfile& as,
                                             const std::string& id,
                                             bool installed_now) {
  // Switched once, by the config or by DefaultSwitch. From then on a switch
  // the config does not set is the user's, which Chrome keeps; one the
  // config stops setting stays where the config left it. One installed
  // before switches existed keeps the switch the user gave it.
  const bool first = !std::ranges::contains(
      profile.GetPrefs()->GetList(kSwitchedPref), base::Value(id));
  if (first) {
    ScopedListPrefUpdate(profile.GetPrefs(), kSwitchedPref)->Append(id);
  }
  const std::optional<bool> configured =
      std::ranges::contains(ConfigExtensionIds(), id) ? ConfigSwitch(as, id)
                                                      : std::nullopt;
  // The user's switch from before this profile had it.
  std::optional<bool> asked;
  if (auto pending = pending_switches_.find(as.id);
      pending != pending_switches_.end()) {
    if (auto switched = pending->second.find(id);
        switched != pending->second.end()) {
      asked = switched->second;
      pending->second.erase(switched);
    }
  }
  if (!configured.has_value() && !asked.has_value() &&
      (!first || !installed_now)) {
    return;
  }
  // One the user installed starts off: the shell asks which profiles it goes
  // on in, and switches it on there.
  const bool on = configured.value_or(asked.value_or(
      std::ranges::contains(ConfigExtensionIds(), id) && DefaultSwitch(as)));
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(&profile);
  if (on == registry->enabled_extensions().Contains(id)) {
    return;
  }
  LOG(INFO) << "domicile: extension " << id << " is switched "
            << (on ? "on" : "off") << " in browser profile " << as.id << ".";
  extensions::ExtensionRegistrar* registrar =
      extensions::ExtensionRegistrar::Get(&profile);
  if (on) {
    registrar->GrantPermissionsAndEnableExtension(
        *registry->GetInstalledExtension(id));
  } else {
    registrar->DisableExtension(
        id, {extensions::disable_reason::DISABLE_USER_ACTION});
  }
}

std::vector<Profile*> BrowserProfileRegistry::ReadyExtensionProfiles() {
  std::vector<Profile*> ready;
  const auto add = [&ready](Profile* profile) {
    if (profile != nullptr &&
        extensions::ExtensionSystem::Get(profile)->ready().is_signaled()) {
      ready.push_back(profile);
    }
  };
  add(shell_);
  for (auto& [id, loaded] : loaded_) {
    add(loaded.profile);
  }
  return ready;
}

void BrowserProfileRegistry::MirrorUserExtensions() {
  if (!extensions_.has_value()) {
    // The config's extensions are not known yet, and the config's own are
    // the config's to install.
    return;
  }
  const std::vector<Profile*> profiles = ReadyExtensionProfiles();
  std::vector<std::vector<UserExtension>> each;
  for (Profile* profile : profiles) {
    std::vector<UserExtension>& own = each.emplace_back();
    for (const auto& extension : extensions::ExtensionRegistry::Get(profile)
                                     ->GenerateInstalledExtensionsSet()) {
      if (std::optional<UserExtension> user = AsUserExtension(*extension)) {
        own.push_back(*std::move(user));
      }
    }
  }
  const std::vector<std::string> config_list = ConfigExtensionIds();
  const std::set<std::string> config_ids(config_list.begin(),
                                         config_list.end());
  for (Profile* profile : profiles) {
    std::set<std::string> installed;
    for (const auto& extension : extensions::ExtensionRegistry::Get(profile)
                                     ->GenerateInstalledExtensionsSet()) {
      installed.insert(extension->id());
    }
    const BrowserProfile* as = AsBrowserProfile(*profile);
    const std::string name = as == nullptr ? std::string() : as->id;
    extensions::PendingExtensionManager* pending =
        extensions::PendingExtensionManager::Get(profile);
    bool from_web_store = false;
    for (const UserExtension& extension :
         UserExtensionsMissing(each, installed, config_ids)) {
      if (pending->IsIdPending(extension.id)) {
        continue;
      }
      LOG(INFO) << "domicile: installing extension " << extension.id
                << " in browser profile " << name
                << ", as the user installed it in another.";
      if (!extension.unpacked.empty()) {
        // Loads outside PendingExtensionManager, so this keeps a second
        // mirroring before it ends from loading it twice.
        const std::pair<base::FilePath, std::string> load = {
            profile->GetPath(), extension.unpacked};
        if (!loading_unpacked_.insert(load).second) {
          continue;
        }
        LoadUnpackedInto(
            *profile, base::FilePath(extension.unpacked),
            base::BindOnce(&BrowserProfileRegistry::OnMirroredUnpackedLoaded,
                           weak_factory_.GetWeakPtr(), load));
        continue;
      }
      // As the config's are (Reconcile says why kInternal):
      // AddFromExternalUpdateUrl refuses an id the user uninstalled here
      // before, which installing it elsewhere overrides.
      extensions::ExtensionPrefs::Get(profile)
          ->ClearExternalExtensionUninstalled(extension.id);
      if (pending->AddFromExternalUpdateUrl(
              extension.id, /*install_parameter=*/std::string(),
              extension_urls::GetWebstoreUpdateUrl(),
              extensions::mojom::ManifestLocation::kInternal,
              extensions::Extension::NO_FLAGS,
              /*mark_acknowledged=*/true)) {
        from_web_store = true;
      } else {
        LOG(ERROR) << "domicile: extension " << extension.id
                   << " would not install in browser profile " << name
                   << " from the Web Store.";
      }
    }
    if (from_web_store) {
      extensions::ExtensionSystem::Get(profile)
          ->extension_service()
          ->CheckForUpdatesSoon();
    }
  }
}

void BrowserProfileRegistry::OnMirroredUnpackedLoaded(
    const std::pair<base::FilePath, std::string>& load,
    base::expected<std::string, std::string> loaded) {
  loading_unpacked_.erase(load);
  if (!loaded.has_value()) {
    LOG(ERROR) << "domicile: the unpacked extension in " << load.second
               << ", installed in another browser profile, did not load in "
               << load.first << ": " << loaded.error();
  }
}

void BrowserProfileRegistry::UninstallAbandoned(base::WeakPtr<Profile> profile,
                                                const std::string& id) {
  if (!profile || extensions::ExtensionRegistry::Get(profile.get())
                          ->GetInstalledExtension(id) == nullptr) {
    return;
  }
  // Not USER_INITIATED, which would uninstall it everywhere again.
  std::u16string error;
  if (!extensions::ExtensionRegistrar::Get(profile.get())
           ->UninstallExtension(
               id, extensions::UNINSTALL_REASON_ORPHANED_EXTERNAL_EXTENSION,
               &error)) {
    LOG(ERROR) << "domicile: extension " << id
               << " would not uninstall from a browser profile it loaded "
                  "into after the user uninstalled it: "
               << base::UTF16ToUTF8(error);
  }
}

void BrowserProfileRegistry::ReloadUnpackedElsewhere(Profile& from,
                                                     const std::string& id) {
  const extensions::Extension* loaded =
      extensions::ExtensionRegistry::Get(&from)->GetInstalledExtension(id);
  // Chromium reports a load as done with extensions disabled too, and adds
  // none.
  if (loaded == nullptr) {
    return;
  }
  // Not each copy's own: a manifest `key` fixes the id wherever the directory
  // is.
  const base::FilePath directory = loaded->path();
  for (Profile* profile : ReadyExtensionProfiles()) {
    const extensions::Extension* extension =
        extensions::ExtensionRegistry::Get(profile)->GetInstalledExtension(id);
    if (profile == &from || extension == nullptr ||
        extension->location() !=
            extensions::mojom::ManifestLocation::kUnpacked) {
      continue;
    }
    const BrowserProfile* as = AsBrowserProfile(*profile);
    LoadUnpackedInto(*profile, directory,
                     base::BindOnce(
                         [](const std::string& name, const std::string& id,
                            base::expected<std::string, std::string> loaded) {
                           if (!loaded.has_value()) {
                             LOG(ERROR)
                                 << "domicile: the unpacked extension " << id
                                 << " did not reload in browser profile "
                                 << name << ": " << loaded.error();
                           }
                         },
                         as == nullptr ? std::string() : as->id, id));
  }
  // A profile where an earlier load failed still lacks it, and a reload is no
  // install that mirrors it.
  MirrorUserExtensions();
}

void BrowserProfileRegistry::UninstallEverywhere(Profile& from,
                                                 const std::string& id) {
  for (Profile* profile : ReadyExtensionProfiles()) {
    if (profile == &from ||
        extensions::ExtensionRegistry::Get(profile)->GetInstalledExtension(
            id) == nullptr) {
      continue;
    }
    const BrowserProfile* as = AsBrowserProfile(*profile);
    LOG(INFO) << "domicile: uninstalling extension " << id
              << " from browser profile "
              << (as == nullptr ? std::string() : as->id)
              << ", as the user uninstalled it from another.";
    // Not USER_INITIATED, which this would hear again from each profile.
    std::u16string error;
    if (!extensions::ExtensionRegistrar::Get(profile)->UninstallExtension(
            id, extensions::UNINSTALL_REASON_ORPHANED_EXTERNAL_EXTENSION,
            &error)) {
      LOG(ERROR) << "domicile: extension " << id
                 << " would not uninstall from a browser profile: "
                 << base::UTF16ToUTF8(error);
    }
  }
}

std::vector<BrowserProfileRegistry::ExtensionSwitch>
BrowserProfileRegistry::ExtensionSwitchesOf(const std::string& id) {
  std::vector<ExtensionSwitch> switches;
  const BrowserProfile* as = profiles_.Find(id);
  Profile* profile = ExtensionsProfileOf(id);
  if (as == nullptr || profile == nullptr) {
    return switches;
  }
  const std::vector<std::string> configured = ConfigExtensionIds();
  for (const InstalledExtension& extension : ExtensionsOf(*profile)) {
    switches.push_back(ExtensionSwitch{
        .id = extension.id,
        .enabled = extension.enabled,
        .locked = std::ranges::contains(configured, extension.id) &&
                  ConfigSwitch(*as, extension.id).has_value()});
  }
  return switches;
}

base::expected<void, std::string> BrowserProfileRegistry::SetExtensionEnabled(
    Profile& shell,
    const std::string& id,
    const std::string& extension,
    bool enabled) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  UseShell(shell);
  if (profiles_.Find(id) == nullptr) {
    return base::unexpected(
        base::StrCat({"the desk has no browser profile \"", id, "\""}));
  }
  Profile* profile = ExtensionsProfileOf(id);
  const bool here =
      profile != nullptr &&
      extensions::ExtensionRegistry::Get(profile)->GetInstalledExtension(
          extension) != nullptr;
  if (!here) {
    // One the user installed reaches this profile soon: as it loads, or
    // through MirrorUserExtensions.
    const bool coming = std::ranges::any_of(
        ReadyExtensionProfiles(), [&extension](Profile* ready) {
          const extensions::Extension* there =
              extensions::ExtensionRegistry::Get(ready)->GetInstalledExtension(
                  extension);
          return there != nullptr && AsUserExtension(*there).has_value();
        });
    if (!coming) {
      return base::unexpected(
          profile == nullptr
              ? base::StrCat({"browser profile ", id, " is still loading"})
              : base::StrCat({"browser profile ", id, " has no extension ",
                              extension, " installed"}));
    }
    LOG(INFO) << "domicile: extension " << extension << " switches "
              << (enabled ? "on" : "off") << " in browser profile " << id
              << " once it is installed there.";
    pending_switches_[id][extension] = enabled;
    return base::ok();
  }
  // SetExtensionEnabledIn refuses one the config switches (IsSwitchLocked).
  return SetExtensionEnabledIn(*profile, extension, enabled);
}

base::expected<void, std::string> BrowserProfileRegistry::ConfigureEverywhere(
    Profile& from,
    const std::string& id,
    const ExtensionSettings& settings) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (base::expected<void, std::string> configured =
          ConfigureExtensionIn(from, id, settings);
      !configured.has_value()) {
    return configured;
  }
  // Whether it runs in private pages is each profile's: a private profile's
  // copy is allowed into its pages (ExtensionsFor).
  ExtensionSettings elsewhere = settings;
  elsewhere.in_private.reset();
  for (Profile* profile : ReadyExtensionProfiles()) {
    if (profile == &from ||
        extensions::ExtensionRegistry::Get(profile)->GetInstalledExtension(
            id) == nullptr) {
      continue;
    }
    const base::expected<void, std::string> configured =
        ConfigureExtensionIn(*profile, id, elsewhere);
    if (!configured.has_value()) {
      const BrowserProfile* as = AsBrowserProfile(*profile);
      LOG(ERROR) << "domicile: extension " << id
                 << "'s settings did not change in browser profile "
                 << (as == nullptr ? std::string() : as->id) << ": "
                 << configured.error();
    }
  }
  return base::ok();
}

bool BrowserProfileRegistry::IsSwitchLocked(
    Profile& profile,
    const std::string& extension) const {
  const BrowserProfile* as = AsBrowserProfile(profile);
  return as != nullptr && ConfigSwitch(*as, extension).has_value() &&
         std::ranges::contains(ConfigExtensionIds(), extension);
}

void BrowserProfileRegistry::ExtensionsChanged() {
  for (Observer& observer : observers_) {
    observer.OnBrowserProfilesChanged();
  }
}

void BrowserProfileRegistry::OnExtensionLoaded(
    content::BrowserContext* context,
    const extensions::Extension* extension) {
  ExtensionsChanged();
}

void BrowserProfileRegistry::OnExtensionUnloaded(
    content::BrowserContext* context,
    const extensions::Extension* extension,
    extensions::UnloadedExtensionReason reason) {
  ExtensionsChanged();
}

void BrowserProfileRegistry::OnExtensionInstalled(
    content::BrowserContext* context,
    const extensions::Extension* extension,
    bool is_update) {
  Profile* profile = Profile::FromBrowserContext(context);
  const BrowserProfile* as = AsBrowserProfile(*profile);
  const bool configured =
      std::ranges::contains(ConfigExtensionIds(), extension->id());
  const std::optional<UserExtension> user_extension =
      AsUserExtension(*extension);
  const bool user = user_extension.has_value();
  // A copy MirrorUserExtensions was still loading when the user uninstalled
  // the extension everywhere else: it leaves too, rather than going back
  // into the others.
  if (!is_update && user && !user_extension->unpacked.empty() &&
      loading_unpacked_.contains(
          {profile->GetPath(), user_extension->unpacked}) &&
      std::ranges::none_of(ReadyExtensionProfiles(), [&](Profile* other) {
        return other != profile &&
               extensions::ExtensionRegistry::Get(other)->GetInstalledExtension(
                   extension->id()) != nullptr;
      })) {
    LOG(INFO) << "domicile: extension " << extension->id()
              << " finished loading in a browser profile after the user "
                 "uninstalled it, so it leaves that one too.";
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&BrowserProfileRegistry::UninstallAbandoned,
                                  weak_factory_.GetWeakPtr(),
                                  profile->GetWeakPtr(), extension->id()));
    return;
  }
  // An update may ask for more; the config consents to that too.
  if (as != nullptr && (configured || (user && !is_update))) {
    GrantPermissionsOf(*profile, *extension);
  }
  if (!is_update && as != nullptr && (configured || user)) {
    SwitchExtension(*profile, *as, extension->id(), /*installed_now=*/true);
  }
  if (!is_update && shell_ != nullptr && profile != shell_) {
    // Posted: file access reloads the extension, which the registry is still
    // telling its observers it installed (as InstallWatch does).
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&BrowserProfileRegistry::TakeUpTheShellsSettingsIn,
                       weak_factory_.GetWeakPtr(), profile->GetWeakPtr(),
                       extension->id()));
  }
  if (!is_update) {
    // One the user installed here goes into every other profile.
    MirrorUserExtensions();
  }
  ExtensionsChanged();
}

void BrowserProfileRegistry::TakeUpTheShellsSettingsIn(
    base::WeakPtr<Profile> profile,
    const std::string& id) {
  if (!profile || shell_ == nullptr) {
    return;
  }
  if (const extensions::Extension* extension =
          extensions::ExtensionRegistry::Get(profile.get())
              ->GetInstalledExtension(id)) {
    TakeUpTheShellsSettings(*profile, *extension);
  }
}

void BrowserProfileRegistry::TakeUpTheShellsSettings(
    Profile& profile,
    const extensions::Extension& extension) {
  const extensions::Extension* there =
      extensions::ExtensionRegistry::Get(shell_)->GetInstalledExtension(
          extension.id());
  if (there == nullptr) {
    return;
  }
  ExtensionSettings settings = SettingsOf(*shell_, *there);
  settings.in_private.reset();
  // Only those this copy can use: a version apart may ask for less.
  const ExtensionSettings usable = SettingsOf(profile, extension);
  if (!usable.file_access.has_value()) {
    settings.file_access.reset();
  }
  if (!usable.user_scripts.has_value()) {
    settings.user_scripts.reset();
  }
  if (!usable.site_access.has_value()) {
    settings.site_access.reset();
    settings.sites.clear();
  }
  // Only those that differ, since file access reloads the extension.
  if (settings.file_access == usable.file_access) {
    settings.file_access.reset();
  }
  if (settings.user_scripts == usable.user_scripts) {
    settings.user_scripts.reset();
  }
  if (settings.site_access == usable.site_access &&
      settings.sites == usable.sites) {
    settings.site_access.reset();
    settings.sites.clear();
  }
  if (settings == ExtensionSettings()) {
    return;
  }
  const base::expected<void, std::string> configured =
      ConfigureExtensionIn(profile, extension.id(), settings);
  if (!configured.has_value()) {
    LOG(ERROR) << "domicile: extension " << extension.id()
               << " did not take up its settings in a browser profile it "
                  "was just installed in: "
               << configured.error();
  }
}

void BrowserProfileRegistry::OnExtensionUninstalled(
    content::BrowserContext* context,
    const extensions::Extension* extension,
    extensions::UninstallReason reason) {
  // One the user uninstalled leaves every profile. The config's own stay
  // the config's: it installs them again.
  if (reason == extensions::UNINSTALL_REASON_USER_INITIATED &&
      !std::ranges::contains(ConfigExtensionIds(), extension->id())) {
    for (auto& [profile, switches] : pending_switches_) {
      switches.erase(extension->id());
    }
    UninstallEverywhere(*Profile::FromBrowserContext(context), extension->id());
  }
  ExtensionsChanged();
}

void BrowserProfileRegistry::OnShutdown(
    extensions::ExtensionRegistry* registry) {
  extension_registries_.RemoveObservation(registry);
}

void BrowserProfileRegistry::EndPrivate(const std::string& id) {
  auto loaded = loaded_.find(id);
  if (loaded == loaded_.end()) {
    return;
  }
  Profile* otr =
      loaded->second.profile->GetPrimaryOTRProfile(/*create_if_needed=*/false);
  // Null when it was destroyed first, which closed the last page.
  if (otr != nullptr) {
    LOG(INFO) << "domicile: ended private browsing in profile " << id << ".";
    loaded->second.ending = otr->GetWeakPtr();
    ProfileDestroyer::DestroyOTRProfileWhenAppropriate(otr);
  }
}

void BrowserProfileRegistry::OnProfileWillBeDestroyed(Profile* profile) {
  observations_.RemoveObservation(profile);
  if (profile == shell_) {
    // Shutdown. Every other profile goes with it.
    shell_ = nullptr;
    loaded_.clear();
    return;
  }
  std::erase_if(loaded_, [profile](const auto& entry) {
    return entry.second.profile == profile;
  });
}

void RegisterBrowserProfilesPrefs(PrefRegistrySimple* registry) {
  registry->RegisterDictionaryPref(kPinnedSitesPref);
  registry->RegisterListPref(kSwitchedPref);
  RegisterSitePrivacyPrefs(registry);
}

void StartBrowserProfiles() {
  SetBrowserProfilesSink(base::BindPostTask(
      content::GetUIThreadTaskRunner({}), base::BindRepeating(&ConfigureFor)));
}

}  // namespace domicile
