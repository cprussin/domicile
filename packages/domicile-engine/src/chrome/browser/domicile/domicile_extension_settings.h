// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_SETTINGS_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_SETTINGS_H_

#include <string>

#include "base/types/expected.h"
#include "components/domicile/browser/extension_settings.h"

class PrefRegistrySimple;
class Profile;

namespace extensions {
class Extension;
}  // namespace extensions

namespace domicile {

// Each extension's chrome://extensions settings, which a desk has no
// chrome://extensions for: whether it runs in private windows and on file://
// pages, may use chrome.userScripts, and which sites it runs on. The config
// sets them (`extensions.settings`) and the Settings app changes them.
// See docs/architecture/EXTENSIONS.md#settings.

// Registers the pref of the settings the config last set.
void RegisterExtensionSettingsPrefs(PrefRegistrySimple* registry);

// `extension`'s settings in `profile`, each unset where it cannot use it.
ExtensionSettings SettingsOf(Profile& profile,
                             const extensions::Extension& extension);

// Sets each of `settings` that is set on extension `id`, as its user would on
// chrome://extensions, or says why not without setting any. One the extension
// cannot use is refused.
base::expected<void, std::string> ConfigureExtensionIn(
    Profile& profile,
    const std::string& id,
    const ExtensionSettings& settings);

// Brings `profile` in line with the config's `settings`: sets them, and puts
// back Chrome's default for each the config set before and no longer does
// (ReconcileSettings). An extension not installed yet gets its settings once
// it is. Errors are logged: the config is not answered.
void ApplyConfigSettings(Profile& profile,
                         const ExtensionSettingsMap& settings);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_EXTENSION_SETTINGS_H_
