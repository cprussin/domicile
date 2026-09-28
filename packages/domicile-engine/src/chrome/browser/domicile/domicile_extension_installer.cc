// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_extension_installer.h"

#include <map>
#include <set>
#include <string>
#include <utility>

#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/one_shot_event.h"
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

// The ids this installer added. A list rather than a mark on each extension,
// because a Web Store install is pending when it is added and an extension
// that does not exist yet has nowhere to carry a mark.
constexpr char kAddedPref[] = "domicile.extensions.added";

void Remember(PrefService& pref_service, const std::string& id) {
  ScopedListPrefUpdate added(pref_service, kAddedPref);
  if (!added->contains(id)) {
    added->Append(id);
  }
}

// The directories as Chromium will record them. `UnpackedInstaller` resolves
// a directory with `base::MakeAbsoluteFilePath` before it loads it, so
// `Extension::path()` is the resolved one: a config naming a symlink would
// otherwise never match what it loaded, and be loaded again on every
// connect. Off the UI thread, because resolving is file IO. One that does not
// resolve is left as it was, for the installer to say why.
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

  // First, so that an unpacked extension whose directory moved -- the same id
  // from a new path -- is gone before the new path loads over it.
  //
  // ORPHANED_EXTERNAL_EXTENSION because that is what this is: the source that
  // named it no longer does. It is also a reason Chromium neither asks policy
  // about nor records as the user's, so the id can be named again later.
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

  // External rather than internal, which is what an extension a machine's own
  // configuration installed is to Chromium. ExternalInstallManager disables
  // one until it is acknowledged only where prompting is on, which is
  // Windows and macOS (`FeatureSwitch::prompt_for_external_extensions`); it is
  // acknowledged here anyway, because naming it is the consent.
  for (const std::string& id : changes.install_from_web_store) {
    // Naming it again is the consent again: an id a user uninstalled is
    // otherwise refused by AddFromExternalUpdateUrl for good.
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

  // DEVELOPER MODE, because Chromium disables an unpacked extension in a
  // profile without it (DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION, from
  // `ExtensionManagement::IsAllowedByUnpackedDeveloperModePolicy`), and a desk
  // has no chrome://extensions to turn it on from. A directory in the config
  // is a developer's extension by definition. Left on when the list empties:
  // the pref may be the user's own.
  if (!changes.load_unpacked.empty()) {
    pref_service.SetBoolean(prefs::kExtensionsUIDeveloperMode, true);
  }
  for (const std::string& directory : changes.load_unpacked) {
    scoped_refptr<extensions::UnpackedInstaller> installer =
        extensions::UnpackedInstaller::Create(profile.get());
    // No dialog: a desk has no window to put one in. The failure is logged
    // by `OnUnpackedLoaded`.
    installer->set_be_noisy_on_failure(false);
    installer->set_completion_callback(
        base::BindOnce(&OnUnpackedLoaded, profile));
    installer->Load(base::FilePath(directory));
  }
}

// Once the profile's installed extensions are loaded. Before then the
// registry is empty, and everything already installed would read as missing.
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
