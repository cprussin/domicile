// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_browser_profiles.h"

#include <string>
#include <utility>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/string_util.h"
#include "base/task/bind_post_task.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/domicile/domicile_extension_installer.h"
#include "chrome/browser/profiles/keep_alive/profile_keep_alive_types.h"
#include "chrome/browser/profiles/keep_alive/scoped_profile_keep_alive.h"
#include "chrome/browser/profiles/profile_destroyer.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/common/pref_names.h"
#include "components/crx_file/id_util.h"
#include "components/domicile/browser/control_channel.h"
#include "components/prefs/pref_registry_simple.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/render_frame_host.h"

namespace domicile {
namespace {

// The sites the user pinned, in the shell's profile: profile ids by site.
constexpr char kPinnedSitesPref[] = "domicile.browser_profiles.pinned_sites";

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

void BrowserProfileRegistry::SetExtensions(Profile& shell, ExtensionList all) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  UseShell(shell);
  extensions_ = std::move(all);
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
  return home->GetPrimaryOTRProfile(/*create_if_needed=*/true);
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
  if (extensions_.has_value()) {
    InstallExtensionsOf(profile, *profiles_.Find(id));
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
  ReconcileConfigExtensions(
      profile.GetWeakPtr(),
      ExtensionsFor(as, *extensions_, [](const std::string& directory) {
        // As the unpacked installer names it: by its resolved path, which
        // InstallExtensionsInto already made it.
        return crx_file::id_util::GenerateIdForPath(base::FilePath(directory));
      }));
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
}

void StartBrowserProfiles() {
  SetBrowserProfilesSink(base::BindPostTask(
      content::GetUIThreadTaskRunner({}), base::BindRepeating(&ConfigureFor)));
}

}  // namespace domicile
