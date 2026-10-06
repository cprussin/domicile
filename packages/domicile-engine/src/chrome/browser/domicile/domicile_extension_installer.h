// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_

#include "base/memory/weak_ptr.h"
#include "components/domicile/browser/extension_installer.h"

class PrefRegistrySimple;
class Profile;

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

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_
