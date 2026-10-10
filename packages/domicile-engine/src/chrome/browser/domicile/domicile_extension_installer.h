// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_

#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/types/expected.h"
#include "components/domicile/browser/extension_installer.h"

class PrefRegistrySimple;
class Profile;

namespace base {
class FilePath;
}

namespace domicile {

// Registers the pref of extension ids `InstallExtensionsInto` added, so it
// only uninstalls extensions it installed.
void RegisterExtensionInstallerPrefs(PrefRegistrySimple* registry);

// Installs the extensions in `wanted` into `profile` and uninstalls ones it
// added earlier that `wanted` no longer lists. Web Store ids install from the
// Store; directories load unpacked. There is no prompt: the config is the
// consent. The diff is `ReconcileExtensions`, which has the tests.
//
// Must be called on the UI thread. `profile` is weak because the request comes
// from the IO thread and the profile may be gone at shutdown.
void InstallExtensionsInto(base::WeakPtr<Profile> profile,
                           const ExtensionList& wanted);

// Loads the unpacked extension in `directory` into `profile` for the Settings
// app. The config did not add it, so reconciling leaves it, and it stays until
// uninstalled. Runs `loaded` with its id, or why it did not load.
void LoadUnpackedInto(
    Profile& profile,
    const base::FilePath& directory,
    base::OnceCallback<void(base::expected<std::string, std::string>)> loaded);

// Uninstalls extension `id` from `profile` as the user would. Refuses one the
// config added: reconciling would install it again.
base::expected<void, std::string> UninstallFrom(Profile& profile,
                                                const std::string& id);

// The ids of the extensions the config added to `profile`.
std::vector<std::string> ConfigExtensionsOf(Profile& profile);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_
