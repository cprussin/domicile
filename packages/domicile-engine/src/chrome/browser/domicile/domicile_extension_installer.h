// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_

#include "base/memory/weak_ptr.h"
#include "components/domicile/browser/extension_installer.h"

class PrefRegistrySimple;
class Profile;

namespace domicile {

// The pref holding the ids `InstallExtensionsInto` added, which is how it
// knows what it may take away.
void RegisterExtensionInstallerPrefs(PrefRegistrySimple* registry);

// Make `profile`'s extensions what the desk's config names: a Web Store id is
// installed from the Store and updates from it, a directory is loaded
// unpacked, and what this added that `wanted` no longer names is uninstalled.
// No prompt: naming it in the config is the consent.
//
// WHAT TO DO is `ReconcileExtensions`, where the tests are; this is the half
// that needs a profile, which is why it lives in //chrome.
//
// By weak pointer because the call arrives from the IO thread, and a profile
// that is gone by then is a desktop ending, with nothing left to install into.
//
// Must be called on the UI thread.
void InstallExtensionsInto(base::WeakPtr<Profile> profile,
                           const ExtensionList& wanted);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_INSTALLER_H_
