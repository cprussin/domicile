// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_APP_ROOTS_H_
#define COMPONENTS_DOMICILE_BROWSER_APP_ROOTS_H_

#include <map>
#include <string>
#include <string_view>

#include "base/files/file_path.h"

namespace domicile {

// The app modules this browser serves, by host: `domicile://app-<id>/`. See
// docs/architecture/APP-MODULES.md.
//
// An app's host comes from its root, so each directory has an origin, and
// with it storage, of its own. Not thread-safe: use it only on the UI thread.
class AppRoots {
 public:
  // One app: the directory it is served from and its module under it.
  struct App {
    base::FilePath root;
    std::string module;
  };

  // The process-wide instance.
  static AppRoots& Get();

  AppRoots();
  AppRoots(const AppRoots&) = delete;
  AppRoots& operator=(const AppRoots&) = delete;
  ~AppRoots();

  // Serves `module` under `root` and returns the app's host. Adding a root
  // again replaces its module.
  std::string Add(const base::FilePath& root, const std::string& module);

  // The app served at `host`, or null for a host no app was added at.
  const App* Find(std::string_view host) const;

 private:
  std::map<std::string, App, std::less<>> apps_;
};

// The host the app served from `root` has: `app-` and the first 32 hex digits
// of the SHA-256 of the path.
std::string AppHostFor(const base::FilePath& root);

// Whether `host` has the shape AppHostFor gives, whether or not an app is
// served there.
bool IsAppHost(std::string_view host);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_APP_ROOTS_H_
