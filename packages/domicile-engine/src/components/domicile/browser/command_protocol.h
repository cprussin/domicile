// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_
#define COMPONENTS_DOMICILE_BROWSER_COMMAND_PROTOCOL_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/functional/function_ref.h"
#include "base/time/time.h"
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
//   {"type":"run_app","version":1,"root":"/opt/notes","module":"notes.js"}
//   -> {"type":"opened"}
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
//   {"type":"extensions","version":1}
//   -> {"type":"extensions","extensions":[{"id":"...","name":"...",
//       "description":"...","version":"1.0","enabled":true,
//       "options_url":"chrome-extension://.../options.html"}]}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"set_extension_enabled","version":1,"id":"...","enabled":false}
//   -> {"type":"set"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"media_devices","version":1}
//   -> {"type":"media_devices",
//       "cameras":[{"id":"/dev/video2","name":"USB Camera"}],
//       "microphones":[...]}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"set_media_device","version":1,"kind":"camera","id":"..."}
//   -> {"type":"set"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"history","version":1,"text":"news",
//    "end_time":1700000000000.5,"max_results":100}
//   -> {"type":"history","items":[{"url":"https://news.example/",
//       "title":"News","favicon":"data:image/png;base64,..."}]}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"visits","version":1,"url":"https://news.example/"}
//   -> {"type":"visits","times":[1700000000000.5]}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"delete_history","version":1,"visits":[1700000000000.5]}
//   -> {"type":"deleted"}
//   -> {"type":"refused","why":"..."}
//
//   {"type":"clear_browsing_data","version":1,"since":1700000000000,
//    "types":["cookies","localStorage"],"origins":["https://a.example"]}
//   -> {"type":"cleared"}
//   -> {"type":"refused","why":"..."}
//
// The site permissions, extensions and media devices are the Settings app's,
// relayed by the supervisor (docs/SETTINGS.md). Names are site_permissions.h's.
// The history and browsing data are the History app's. Times are milliseconds
// since the Unix epoch, fractional to the microsecond, as `chrome.history`
// gives them.
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

// Runs once with whether `load_shell` loaded the shell: false if there is no
// shell window to load it into.
using ShellLoaded = base::OnceCallback<void(bool loaded)>;

// Carries out `load_shell`: serves this shell and shows it. Runs `loaded`
// once, possibly after returning, as the shell window's first page may still
// be loading.
using LoadShell = base::FunctionRef<void(const base::FilePath& root,
                                         const std::string& module,
                                         ShellLoaded loaded)>;

// Runs once with whether `run_app` or `open_url` opened its window: false if
// there is no shell to own it.
using WindowOpened = base::OnceCallback<void(bool opened)>;

// Carries out `run_app`: serves the app module `module` under `root` and opens
// an app window on it. Runs `opened` once, possibly after returning, as the
// shell window's first page may still be loading. See
// docs/architecture/APP-MODULES.md.
using RunApp = base::FunctionRef<void(const base::FilePath& root,
                                      const std::string& module,
                                      WindowOpened opened)>;

// Carries out `open_url`: opens a browser window at `url`, or with `app` an app
// window, which the shell draws without an address bar. Runs `opened` once,
// possibly after returning, as for `run_app`.
using OpenUrl =
    base::FunctionRef<void(const GURL& url, bool app, WindowOpened opened)>;

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

// An extension in the shell's profile, as the Settings app lists it.
struct InstalledExtension {
  InstalledExtension();
  InstalledExtension(const InstalledExtension&);
  InstalledExtension& operator=(const InstalledExtension&);
  ~InstalledExtension();

  std::string id;
  std::string name;
  std::string description;
  std::string version;
  bool enabled = false;
  // Empty when the extension has no options page.
  GURL options_url;
};

// Carries out `extensions`: every extension in the shell's profile, apps,
// themes and Chrome's own left out. Returns nothing if there is no shell, and
// so no profile to read.
using ListExtensions =
    base::FunctionRef<std::optional<std::vector<InstalledExtension>>()>;

// Carries out `set_extension_enabled`, or says why it did not.
using SetExtensionEnabled =
    base::FunctionRef<base::expected<void, std::string>(const std::string& id,
                                                       bool enabled)>;

// A camera or a microphone.
struct MediaDevice {
  // The system's id for it, which Chrome's device preference stores.
  std::string id;
  std::string name;
};

// Each kind's devices, most preferred first. A site that names no device gets
// the first.
struct MediaDeviceList {
  MediaDeviceList();
  MediaDeviceList(const MediaDeviceList&);
  MediaDeviceList& operator=(const MediaDeviceList&);
  ~MediaDeviceList();

  std::vector<MediaDevice> cameras;
  std::vector<MediaDevice> microphones;
};

enum class MediaDeviceKind { kCamera, kMicrophone };

// Carries out `media_devices`. Returns nothing if there is no shell, and so
// no profile whose preference ranks them.
using ListMediaDevices = base::FunctionRef<std::optional<MediaDeviceList>()>;

// Carries out `set_media_device`: sites that ask for a `kind` without naming a
// device get `id`. Says why not when there is no such device.
using SetMediaDevice =
    base::FunctionRef<base::expected<void, std::string>(MediaDeviceKind kind,
                                                        const std::string& id)>;

// Runs once when a command that answers later is done, or with why it is not.
using CommandDone = base::OnceCallback<void(base::expected<void, std::string>)>;

// What `history` looks for: like `chrome.history.search` from the start of
// time.
struct HistorySearch {
  // Matched against each page's title and address; empty matches every page.
  std::string text;
  // Only visits before this count.
  base::Time end_time;
  int max_results = 0;
};

// A page in the history, as the History app lists it.
struct HistoryEntry {
  HistoryEntry();
  HistoryEntry(const HistoryEntry&);
  HistoryEntry& operator=(const HistoryEntry&);
  ~HistoryEntry();

  GURL url;
  std::string title;
  // The page's cached favicon as a PNG, or empty when there is none.
  std::vector<uint8_t> favicon_png;
};

// Runs once with the pages `history` found, most recently visited first, or
// why it could not look.
using HistoryFound = base::OnceCallback<void(
    base::expected<std::vector<HistoryEntry>, std::string>)>;

// Carries out `history` in the shell's profile. Runs `found` once, possibly
// after returning.
using SearchHistory =
    base::FunctionRef<void(const HistorySearch& search, HistoryFound found)>;

// Runs once with the times of a page's visits, or why it could not look.
using VisitsFound = base::OnceCallback<void(
    base::expected<std::vector<base::Time>, std::string>)>;

// Carries out `visits`: every visit to `url` in the shell's profile. Runs
// `found` once, possibly after returning.
using ListVisits = base::FunctionRef<void(const GURL& url, VisitsFound found)>;

// Carries out `delete_history`: removes the visits at exactly these times, as
// their user would. Runs `done` once, possibly after returning.
using DeleteVisits =
    base::FunctionRef<void(const std::vector<base::Time>& visits,
                           CommandDone done)>;

// The kinds of data `clear_browsing_data` clears, as `chrome.browsingData`
// names them.
enum class BrowsingDataKind {
  kCache,
  kCacheStorage,
  kCookies,
  kDownloads,
  kFileSystems,
  kFormData,
  kHistory,
  kIndexedDB,
  kLocalStorage,
  kPasswords,
  kServiceWorkers,
  kWebSQL,
};

// What `clear_browsing_data` clears.
struct BrowsingDataClearing {
  BrowsingDataClearing();
  BrowsingDataClearing(const BrowsingDataClearing&);
  BrowsingDataClearing& operator=(const BrowsingDataClearing&);
  ~BrowsingDataClearing();

  // Data changed since this; null for all time.
  base::Time since;
  std::vector<BrowsingDataKind> kinds;
  // Only these sites' data, or every site's when empty. Only kinds kept per
  // site may be cleared per site.
  std::vector<url::Origin> origins;
};

// Carries out `clear_browsing_data` in the shell's profile. Runs `done` once,
// possibly after returning.
using ClearBrowsingData =
    base::FunctionRef<void(const BrowsingDataClearing& clearing,
                           CommandDone done)>;

// What each command does, injected so this file can be tested with strings.
struct CommandActions {
  LoadShell load_shell;
  RunApp run_app;
  OpenUrl open_url;
  ListSitePermissions list_site_permissions;
  SetSitePermission set_site_permission;
  LoadUnpacked load_unpacked;
  UninstallExtension uninstall_extension;
  ListConfigExtensions list_config_extensions;
  ListExtensions list_extensions;
  SetExtensionEnabled set_extension_enabled;
  ListMediaDevices list_media_devices;
  SetMediaDevice set_media_device;
  SearchHistory search_history;
  ListVisits list_visits;
  DeleteVisits delete_visits;
  ClearBrowsingData clear_browsing_data;
};

// Receives the reply line, including its trailing newline.
using CommandReply = base::OnceCallback<void(std::string)>;

// Answers one request line (without its newline). `reply` runs once: before
// this returns, except for `load_shell`, `run_app`, `open_url`,
// `load_unpacked`, `history`, `visits`, `delete_history` and
// `clear_browsing_data`, which answer once their action is done.
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
