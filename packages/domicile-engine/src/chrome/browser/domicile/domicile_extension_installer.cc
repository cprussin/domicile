// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_extension_installer.h"

#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/one_shot_event.h"
#include "base/strings/strcat.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/thread_pool.h"
#include "base/values.h"
#include "chrome/browser/extensions/extension_service.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_registry_simple.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "content/public/browser/browser_thread.h"
#include "extensions/browser/extension_prefs.h"
#include "extensions/browser/extension_registrar.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_system.h"
#include "extensions/browser/pending_extension_manager.h"
#include "extensions/browser/uninstall_reason.h"
#include "extensions/browser/unpacked_installer.h"
#include "extensions/common/extension.h"
#include "extensions/common/extension_set.h"
#include "extensions/common/extension_urls.h"
#include "extensions/common/mojom/manifest.mojom-shared.h"

namespace domicile {
namespace {

// The ids this installer added. Stored as a list because a pending Web Store
// install has no extension to mark yet.
constexpr char kAddedPref[] = "domicile.extensions.added";

void Remember(PrefService& pref_service, const std::string& id) {
  ScopedListPrefUpdate added(pref_service, kAddedPref);
  if (!added->contains(id)) {
    added->Append(id);
  }
}

// Chromium disables unpacked extensions without developer mode
// (`ExtensionManagement::IsAllowedByUnpackedDeveloperModePolicy`), and a desk
// has no chrome://extensions to enable it. Never turned off, since the user
// may have set it.
void AllowUnpacked(PrefService& pref_service) {
  pref_service.SetBoolean(prefs::kExtensionsUIDeveloperMode, true);
}

void OnLoadedForSettings(
    base::OnceCallback<void(base::expected<std::string, std::string>)> loaded,
    const extensions::Extension* extension,
    const base::FilePath& directory,
    const std::u16string& error) {
  if (!extension) {
    std::move(loaded).Run(base::unexpected(
        base::StrCat({directory.value(), " did not load: ",
                      base::UTF16ToUTF8(error)})));
    return;
  }
  std::move(loaded).Run(base::ok(extension->id()));
}

// Resolves unpacked directories the way `UnpackedInstaller` does, so they
// match `Extension::path()`. Otherwise a symlinked path would never match and
// would reload on every connect. Does file IO, so runs off the UI thread.
// Unresolvable paths are kept for the installer to report.
ExtensionList Resolved(ExtensionList wanted) {
  for (std::string& directory : wanted.unpacked) {
    const base::FilePath resolved =
        base::MakeAbsoluteFilePath(base::FilePath(directory));
    if (!resolved.empty()) {
      directory = resolved.value();
    }
  }
  return wanted;
}

void OnUnpackedLoaded(base::WeakPtr<Profile> profile,
                      const extensions::Extension* extension,
                      const base::FilePath& directory,
                      const std::u16string& error) {
  if (!extension) {
    LOG(ERROR) << "domicile: the desk's config names " << directory
               << " as an unpacked extension, and it did not load: "
               << base::UTF16ToUTF8(error);
    return;
  }
  if (profile) {
    Remember(*profile->GetPrefs(), extension->id());
  }
}

void Reconcile(base::WeakPtr<Profile> profile, const ExtensionList& wanted) {
  if (!profile) {
    return;
  }
  PrefService& pref_service = *profile->GetPrefs();

  std::set<std::string> installed;
  std::map<std::string, std::string> unpacked;
  for (const scoped_refptr<const extensions::Extension>& extension :
       extensions::ExtensionRegistry::Get(profile.get())
           ->GenerateInstalledExtensionsSet()) {
    installed.insert(extension->id());
    if (extension->location() ==
        extensions::mojom::ManifestLocation::kUnpacked) {
      unpacked.emplace(extension->path().value(), extension->id());
    }
  }
  std::set<std::string> added;
  for (const base::Value& id : pref_service.GetList(kAddedPref)) {
    added.insert(id.GetString());
  }

  const ExtensionChanges changes =
      ReconcileExtensions(wanted, installed, unpacked, added);

  // Uninstall first, so an unpacked extension that moved (same id, new path)
  // is gone before the new path loads.
  //
  // ORPHANED_EXTERNAL_EXTENSION skips the policy check and is not recorded as
  // a user uninstall, so the id can be configured again later.
  for (const std::string& id : changes.uninstall) {
    std::u16string error;
    if (extensions::ExtensionRegistrar::Get(profile.get())
            ->UninstallExtension(
                id, extensions::UNINSTALL_REASON_ORPHANED_EXTERNAL_EXTENSION,
                &error)) {
      ScopedListPrefUpdate(pref_service, kAddedPref)
          ->EraseValue(base::Value(id));
    } else {
      LOG(ERROR) << "domicile: the desk's config no longer names extension "
                 << id << ", and it would not uninstall: "
                 << base::UTF16ToUTF8(error);
    }
  }

  // Installed as external, which is how Chromium treats extensions from
  // machine configuration. Marked acknowledged so it is never disabled
  // pending a prompt (`FeatureSwitch::prompt_for_external_extensions`).
  for (const std::string& id : changes.install_from_web_store) {
    // AddFromExternalUpdateUrl refuses ids the user uninstalled; the config
    // overrides that.
    extensions::ExtensionPrefs::Get(profile.get())
        ->ClearExternalExtensionUninstalled(id);
    if (extensions::PendingExtensionManager::Get(profile.get())
            ->AddFromExternalUpdateUrl(
                id, /*install_parameter=*/std::string(),
                extension_urls::GetWebstoreUpdateUrl(),
                extensions::mojom::ManifestLocation::kExternalPrefDownload,
                extensions::Extension::NO_FLAGS,
                /*mark_acknowledged=*/true)) {
      Remember(pref_service, id);
    }
  }
  if (!changes.install_from_web_store.empty()) {
    extensions::ExtensionSystem::Get(profile.get())
        ->extension_service()
        ->CheckForUpdatesSoon();
  }

  if (!changes.load_unpacked.empty()) {
    AllowUnpacked(pref_service);
  }
  for (const std::string& directory : changes.load_unpacked) {
    scoped_refptr<extensions::UnpackedInstaller> installer =
        extensions::UnpackedInstaller::Create(profile.get());
    // A desk has no window for an error dialog; `OnUnpackedLoaded` logs
    // failures.
    installer->set_be_noisy_on_failure(false);
    installer->set_completion_callback(
        base::BindOnce(&OnUnpackedLoaded, profile));
    installer->Load(base::FilePath(directory));
  }
}

// Waits for the extension system to load; until then the registry is empty
// and every installed extension would look missing.
void ReconcileWhenReady(base::WeakPtr<Profile> profile, ExtensionList wanted) {
  if (!profile) {
    return;
  }
  extensions::ExtensionSystem::Get(profile.get())
      ->ready()
      .Post(FROM_HERE,
            base::BindOnce(&Reconcile, profile, std::move(wanted)));
}

}  // namespace

void LoadUnpackedInto(
    Profile& profile,
    const base::FilePath& directory,
    base::OnceCallback<void(base::expected<std::string, std::string>)> loaded) {
  AllowUnpacked(*profile.GetPrefs());
  scoped_refptr<extensions::UnpackedInstaller> installer =
      extensions::UnpackedInstaller::Create(&profile);
  // A desk has no window for an error dialog; the Settings app shows the
  // error.
  installer->set_be_noisy_on_failure(false);
  installer->set_completion_callback(
      base::BindOnce(&OnLoadedForSettings, std::move(loaded)));
  installer->Load(directory);
}

base::expected<void, std::string> UninstallFrom(Profile& profile,
                                                const std::string& id) {
  for (const base::Value& added : profile.GetPrefs()->GetList(kAddedPref)) {
    if (added.GetString() == id) {
      return base::unexpected(
          "the desk's config installs this extension, so it uninstalls only "
          "when the config's extensions no longer list it");
    }
  }
  if (extensions::ExtensionRegistry::Get(&profile)->GetInstalledExtension(
          id) == nullptr) {
    return base::unexpected(
        base::StrCat({"no extension ", id, " is installed"}));
  }
  std::u16string error;
  if (!extensions::ExtensionRegistrar::Get(&profile)->UninstallExtension(
          id, extensions::UNINSTALL_REASON_USER_INITIATED, &error)) {
    return base::unexpected(base::UTF16ToUTF8(error));
  }
  return base::ok();
}

std::vector<std::string> ConfigExtensionsOf(Profile& profile) {
  std::vector<std::string> ids;
  for (const base::Value& id : profile.GetPrefs()->GetList(kAddedPref)) {
    ids.push_back(id.GetString());
  }
  return ids;
}

void RegisterExtensionInstallerPrefs(PrefRegistrySimple* registry) {
  registry->RegisterListPref(kAddedPref);
}

void InstallExtensionsInto(base::WeakPtr<Profile> profile,
                           const ExtensionList& wanted) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock()}, base::BindOnce(&Resolved, wanted),
      base::BindOnce(&ReconcileWhenReady, std::move(profile)));
}

}  // namespace domicile
