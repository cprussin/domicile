// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_
#define COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/functional/function_ref.h"
#include "base/types/expected.h"
#include "components/domicile/mojom/web_view_guest.mojom-shared.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace domicile {

// The command protocol: requests a running engine accepts about the shell it
// serves. Each connection carries one JSON request line and one reply line.
//
//   {"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
//   -> {"type":"loaded"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"open_url","version":1,"url":"https://example.com/"}
//   {"type":"open_url","version":1,"url":"https://example.com/","app":true}
//   -> {"type":"opened"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"site_permissions","version":1}
//   -> {"type":"site_permissions","defaults":{"camera":"ask",...},
//       "sites":[{"origin":"https://meet.example","permission":"camera",
//                 "setting":"allow"}]}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"set_site_permission","version":1,
//    "origin":"https://meet.example","permission":"camera","setting":"block"}
//   -> {"type":"set"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"load_unpacked","version":1,"directory":"/home/me/src/x"}
//   -> {"type":"loaded_unpacked","id":"..."}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"uninstall_extension","version":1,"id":"..."}
//   -> {"type":"uninstalled"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"config_extensions","version":1}
//   -> {"type":"config_extensions","ids":["..."]}
//   -> {"type":"refused","why":"..."}
//
// The site permissions and extensions are the Settings app's, relayed by the
// supervisor (docs/SETTINGS.md). Names are site_permissions.h's.
//
// This file only parses and answers lines; the actions are injected so it can
// be tested with strings. chrome/browser/domicile/domicile_command_socket.cc
// owns the socket.

// The command protocol version.
//
// The supervisor and the engine ship separately (`engine-release.nix` pins the
// engine), so the two ends can run different revisions. Each request carries
// the version because there is no handshake. An engine that does not speak it
// refuses the request and names both versions.
inline constexpr int kCommandVersion = 1;

// Carries out `load_shell`: serves this shell and shows it. Returns false if
// there is no shell window to load it into.
using LoadShell =
    base::FunctionRef<bool(const base::FilePath& root,
                           const std::string& module)>;

// Carries out `open_url`: opens a browser window at `url`, or with `app` an app
// window, which the shell draws without an address bar. Returns false if there
// is no shell to own the window.
using OpenUrl = base::FunctionRef<bool(const GURL& url, bool app)>;

// One site's stored setting for one permission.
struct StoredSitePermission {
  url::Origin origin;
  mojom::WebViewPermission permission;
  mojom::WebViewPermissionSetting setting;
};

// Every permission's default and every site's stored setting.
struct SitePermissionList {
  SitePermissionList();
  SitePermissionList(const SitePermissionList&);
  SitePermissionList& operator=(const SitePermissionList&);
  ~SitePermissionList();

  std::vector<
      std::pair<mojom::WebViewPermission, mojom::WebViewPermissionSetting>>
      defaults;
  std::vector<StoredSitePermission> sites;
};

// Carries out `site_permissions`. Returns nothing if there is no shell, and so
// no profile to read.
using ListSitePermissions =
    base::FunctionRef<std::optional<SitePermissionList>()>;

// Carries out `set_site_permission`, storing the default as no setting.
// Returns false if there is no shell, and so no profile to store in.
using SetSitePermission =
    base::FunctionRef<bool(const url::Origin& origin,
                           mojom::WebViewPermission permission,
                           mojom::WebViewPermissionSetting setting)>;

// Runs once with the id of the extension `load_unpacked` loaded, or the
// reason it did not load.
using UnpackedLoaded =
    base::OnceCallback<void(base::expected<std::string, std::string>)>;

// Carries out `load_unpacked`: loads the extension in `directory` into the
// shell's profile, where it stays until uninstalled. Runs `loaded` once,
// possibly after returning.
using LoadUnpacked =
    base::FunctionRef<void(const base::FilePath& directory,
                           UnpackedLoaded loaded)>;

// Carries out `uninstall_extension`, or says why it did not.
using UninstallExtension =
    base::FunctionRef<base::expected<void, std::string>(const std::string& id)>;

// Carries out `config_extensions`: the ids the desk's config installed, which
// only the config uninstalls. Returns nothing if there is no shell, and so no
// profile to read.
using ListConfigExtensions =
    base::FunctionRef<std::optional<std::vector<std::string>>()>;

// What each command does, injected so this file can be tested with strings.
struct CommandActions {
  LoadShell load_shell;
  OpenUrl open_url;
  ListSitePermissions list_site_permissions;
  SetSitePermission set_site_permission;
  LoadUnpacked load_unpacked;
  UninstallExtension uninstall_extension;
  ListConfigExtensions list_config_extensions;
};

// Receives the reply line, including its trailing newline.
using CommandReply = base::OnceCallback<void(std::string)>;

// Answers one request line (without its newline). `reply` runs once: before
// this returns, except for `load_unpacked`, which answers once the extension
// has loaded.
void AnswerCommand(std::string_view line,
                   const CommandActions& actions,
                   CommandReply reply);

// Returns the refusal reply line for `why`.
//
// Public so the socket can refuse a peer that never ends a line with the same
// reply shape.
std::string RefusedCommand(std::string_view why);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_
