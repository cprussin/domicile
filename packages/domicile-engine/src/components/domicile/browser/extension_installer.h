// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_EXTENSION_INSTALLER_H_
#define COMPONENTS_DOMICILE_BROWSER_EXTENSION_INSTALLER_H_

#include <map>
#include <set>
#include <string>
#include <vector>

namespace domicile {

// The extensions a desk's config names, as the compositor's `extensions`
// message carries them. See docs/architecture/EXTENSIONS.md.
struct ExtensionList {
  // Chrome Web Store ids.
  std::vector<std::string> web_store;
  // Absolute directories holding an unpacked extension.
  std::vector<std::string> unpacked;
};

// What to do to a profile so it holds what an `ExtensionList` names.
struct ExtensionChanges {
  // Ids to install from the Web Store.
  std::vector<std::string> install_from_web_store;
  // Directories to load.
  std::vector<std::string> load_unpacked;
  // Ids to uninstall.
  std::vector<std::string> uninstall;
};

// The decision half of the installer; carrying it out is
// chrome/browser/domicile/domicile_extension_installer.h.
//
// `installed` is every extension the profile has, `unpacked` the directory
// each unpacked one was loaded from, and `added` what this installer put there.
//
// WHAT IS THERE IS NOT ASKED FOR AGAIN. Every shell window's channel sends the
// list when it connects, so a desk of three monitors asks three times:
// installing an installed id again is a DFATAL in PendingExtensionManager, and
// loading a directory again restarts its extension.
//
// ONLY WHAT THIS ADDED IS TAKEN AWAY. The profile is the one browser windows
// use, and an extension the user put there themselves is not the config's.
ExtensionChanges ReconcileExtensions(
    const ExtensionList& wanted,
    const std::set<std::string>& installed,
    const std::map<std::string, std::string>& unpacked,
    const std::set<std::string>& added);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_EXTENSION_INSTALLER_H_
