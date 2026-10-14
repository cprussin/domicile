// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_command_socket.h"

#include <unistd.h>

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/check_op.h"
#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/time/time.h"
#include "base/types/expected.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "chrome/browser/domicile/domicile_extension_installer.h"
#include "chrome/browser/domicile/domicile_history.h"
#include "chrome/browser/domicile/domicile_media_devices.h"
#include "chrome/browser/profiles/profile.h"
#include "base/task/bind_post_task.h"
#include "chrome/browser/ui/browser_window/public/browser_collection.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_pattern.h"
#include "components/domicile/browser/app_roots.h"
#include "components/domicile/browser/command_protocol.h"
#include "components/domicile/browser/shell_source.h"
#include "components/domicile/browser/shell_window_wait.h"
#include "components/domicile/browser/site_permissions.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "components/permissions/permissions_client.h"
#include "components/domicile/common/domicile_scheme.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/site_instance.h"
#include "content/public/browser/web_contents.h"
#include "net/base/io_buffer.h"
#include "net/base/net_errors.h"
#include "net/socket/stream_socket.h"
#include "net/socket/unix_domain_server_socket_posix.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace domicile {
namespace {

// Commands are served one at a time. The backlog lets a concurrent
// `domicile load-shell` wait instead of being refused by the kernel.
constexpr int kBacklog = 4;

constexpr int kReadBufferSize = 4 * 1024;

// Caps a request line so a peer that never sends a newline cannot grow the
// heap.
constexpr size_t kMaxRequestSize = 64 * 1024;

// Accepts only peers running as this user. The socket's directory already
// limits access; this is a second check.
bool ConnectedByUs(const net::UnixDomainServerSocket::Credentials& peer) {
  return peer.user_id == getuid();
}

// The shell's window, or null when this browser has none.
//
// Matched by the domicile:// scheme. Searched in creation order so the result
// does not depend on which window was last focused.
content::WebContents* FindShellContents() {
  content::WebContents* shell = nullptr;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&shell](BrowserWindowInterface* browser) {
        tabs::TabInterface* tab = browser->GetActiveTabInterface();
        if (tab != nullptr &&
            tab->GetContents()->GetLastCommittedURL().SchemeIs(
                kDomicileScheme)) {
          shell = tab->GetContents();
          return false;
        }
        return true;
      },
      BrowserCollection::Order::kCreation);
  return shell;
}

// Whether a window is opening a domicile:// address it has not committed yet,
// as the shell's window is until its first page commits. The startup
// navigation is browser-initiated, so its address is the visible one.
bool AWindowIsOpeningTheShell() {
  bool opening = false;
  GlobalBrowserCollection::GetInstance()->ForEach(
      [&opening](BrowserWindowInterface* browser) {
        tabs::TabInterface* tab = browser->GetActiveTabInterface();
        if (tab != nullptr &&
            tab->GetContents()->GetVisibleURL().SchemeIs(kDomicileScheme)) {
          opening = true;
          return false;
        }
        return true;
      },
      BrowserCollection::Order::kCreation);
  return opening;
}

ShellWindowState LookForTheShellWindow() {
  if (FindShellContents() != nullptr) {
    return ShellWindowState::kShowingAPage;
  }
  return AWindowIsOpeningTheShell() ? ShellWindowState::kOpening
                                    : ShellWindowState::kAbsent;
}

// How long `load_shell` waits for the shell window's first page. Under the
// supervisor's wait for a reply (`PATIENCE` in domicile-launch's
// control_socket.rs), so the supervisor hears the refusal and asks again.
constexpr base::TimeDelta kFirstPagePatience = base::Seconds(3);

// Serves the shell at `root`/`module` and loads it into the shell window's
// page, or refuses when there is none.
//
// The source is set before the navigation because the navigation reads it.
//
// A renderer-initiated replacement rather than a reload: Chromium runs a
// cross-document view transition only for that kind of navigation, and the
// shell document's `@view-transition` crossfades the splash into the built
// shell. Shell files are served `no-store` (ShellURLLoaderFactory), so a
// rebuilt shell with the same URLs is read fresh.
void LoadShellIntoAPage(const base::FilePath& root,
                        const std::string& module,
                        ShellLoaded loaded,
                        bool has_a_page) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!has_a_page) {
    std::move(loaded).Run(false);
    return;
  }

  // WhenTheShellWindowHasAPage found it in this same task.
  content::WebContents* shell = FindShellContents();
  CHECK(shell);

  ShellSource::Get().Set(root, module);
  content::RenderFrameHost* page = shell->GetPrimaryMainFrame();
  content::NavigationController::LoadURLParams params(
      shell->GetLastCommittedURL());
  params.transition_type = ui::PAGE_TRANSITION_LINK;
  params.should_replace_current_entry = true;
  params.is_renderer_initiated = true;
  params.initiator_origin = page->GetLastCommittedOrigin();
  params.source_site_instance = page->GetSiteInstance();
  shell->GetController().LoadURLWithParams(params);
  LOG(INFO) << "domicile: now serving " << module << " out of " << root;
  std::move(loaded).Run(true);
}

// Serves the shell at `root`/`module` and loads it into the shell window, once
// that window shows a page.
//
// The socket binds before the shell window's first page commits, so a shell
// built quickly can arrive while that page is loading. The load navigates from
// the committed page, so this waits for it rather than refusing.
void LoadShellIntoTheShellWindow(const base::FilePath& root,
                                 const std::string& module,
                                 ShellLoaded loaded) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  WhenTheShellWindowHasAPage(
      base::BindRepeating(&LookForTheShellWindow), kFirstPagePatience,
      base::BindOnce(&LoadShellIntoAPage, root, module, std::move(loaded)));
}

// Serves the app module `module` under `root` and opens an app window pinned
// to it. See docs/architecture/APP-MODULES.md.
bool RunAppInAnAppWindow(const base::FilePath& root,
                         const std::string& module) {
  const std::string host = AppRoots::Get().Add(root, module);
  LOG(INFO) << "domicile: running the app " << module << " out of " << root
            << " at " << kDomicileScheme << "://" << host << "/";
  return OpenAppModuleWindow(
      GURL(base::StrCat({kDomicileScheme, "://", host, "/"})), host);
}

// Opens a browser window at `url`, as for a page's target="_blank", or with
// `app` an app window. The shell sees it in its window list. See
// domicile_browser_windows.h.
bool OpenUrlInABrowserWindow(const GURL& url, bool app) {
  return OpenBrowserWindow(url, app);
}

// The site settings of the shell's profile, which browser windows share, or
// null when there is no shell.
HostContentSettingsMap* ShellSettings() {
  content::WebContents* shell = FindShellContents();
  if (shell == nullptr) {
    return nullptr;
  }
  return permissions::PermissionsClient::Get()->GetSettingsMap(
      shell->GetBrowserContext());
}

// Each permission's default and each site's own setting, as the address
// bar's panel stores them: user settings for one origin. Settings from
// policy or extensions, and patterns wider than an origin, are left out,
// since `set_site_permission` could not change them.
std::optional<SitePermissionList> ListShellSitePermissions() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);

  const HostContentSettingsMap* map = ShellSettings();
  if (map == nullptr) {
    return std::nullopt;
  }
  SitePermissionList list;
  for (const mojom::WebViewPermission permission : kSitePermissions) {
    const ContentSettingsType type = SettingsTypeFor(permission);
    list.defaults.emplace_back(permission,
                               SettingFor(map->GetDefaultContentSetting(type)));
    for (const ContentSettingPatternSource& rule :
         map->GetSettingsForOneType(type)) {
      const ContentSetting setting = rule.GetContentSetting();
      const bool shown = setting == CONTENT_SETTING_ASK ||
                         setting == CONTENT_SETTING_ALLOW ||
                         setting == CONTENT_SETTING_BLOCK;
      const GURL site = rule.primary_pattern.ToRepresentativeUrl();
      if (rule.source != content_settings::ProviderType::kPrefProvider ||
          rule.incognito || !shown || rule.primary_pattern.MatchesAllHosts() ||
          rule.primary_pattern.HasDomainWildcard() || !site.is_valid() ||
          !HasSitePermissions(site)) {
        continue;
      }
      list.sites.push_back({url::Origin::Create(site), permission,
                            SettingFor(setting)});
    }
  }
  return list;
}

// Stores `origin`'s setting as the address bar's panel does
// (WebViewGuest::SetSitePermission). Open browser windows on the site see the
// change through their content settings observers.
bool SetShellSitePermission(const url::Origin& origin,
                            mojom::WebViewPermission permission,
                            mojom::WebViewPermissionSetting setting) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);

  HostContentSettingsMap* map = ShellSettings();
  if (map == nullptr) {
    return false;
  }
  const GURL site = origin.GetURL();
  const ContentSettingsType type = SettingsTypeFor(permission);
  map->SetContentSettingDefaultScope(
      site, site, type,
      StoredSetting(setting, map->GetDefaultContentSetting(type)));
  return true;
}

// The shell's profile, which browser windows share, or null when there is no
// shell.
Profile* ShellProfile() {
  content::WebContents* shell = FindShellContents();
  if (shell == nullptr) {
    return nullptr;
  }
  return Profile::FromBrowserContext(shell->GetBrowserContext());
}

constexpr char kNoProfile[] =
    "this engine has no shell, and so no profile to hold extensions";

void LoadUnpackedIntoTheShellProfile(const base::FilePath& directory,
                                     UnpackedLoaded loaded) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    std::move(loaded).Run(base::unexpected(kNoProfile));
    return;
  }
  LoadUnpackedInto(*profile, directory, std::move(loaded));
}

base::expected<void, std::string> UninstallFromTheShellProfile(
    const std::string& id) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    return base::unexpected(kNoProfile);
  }
  return UninstallFrom(*profile, id);
}

std::optional<std::vector<std::string>> ListTheShellProfilesConfigExtensions() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    return std::nullopt;
  }
  return ConfigExtensionsOf(*profile);
}

// The shell profile's extensions, for the Settings app.
std::optional<std::vector<InstalledExtension>> ListShellExtensions() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    return std::nullopt;
  }
  return ExtensionsOf(*profile);
}

base::expected<void, std::string> SetShellExtensionEnabled(
    const std::string& id,
    bool enabled) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    return base::unexpected(kNoProfile);
  }
  return SetExtensionEnabledIn(*profile, id, enabled);
}

// The cameras and microphones, ranked by the shell profile's preference.
std::optional<MediaDeviceList> ListShellMediaDevices() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    return std::nullopt;
  }
  return RankedMediaDevices(*profile->GetPrefs());
}

base::expected<void, std::string> PreferShellMediaDevice(
    MediaDeviceKind kind,
    const std::string& id) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    return base::unexpected(
        "this engine has no shell, and so no profile to store the device in");
  }
  return PreferMediaDevice(*profile->GetPrefs(), kind, id);
}

constexpr char kNoHistory[] =
    "this engine has no shell, and so no profile to hold history and browsing "
    "data";

// The shell profile's history and browsing data, for the History app.
void SearchShellHistory(const HistorySearch& search, HistoryFound found) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    std::move(found).Run(base::unexpected(kNoHistory));
    return;
  }
  SearchHistoryIn(*profile, search, std::move(found));
}

void ListShellVisits(const GURL& url, VisitsFound found) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    std::move(found).Run(base::unexpected(kNoHistory));
    return;
  }
  ListVisitsIn(*profile, url, std::move(found));
}

void DeleteShellVisits(const std::vector<base::Time>& visits,
                       CommandDone done) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    std::move(done).Run(base::unexpected(kNoHistory));
    return;
  }
  DeleteVisitsIn(*profile, visits, std::move(done));
}

void ClearShellBrowsingData(const BrowsingDataClearing& clearing,
                            CommandDone done) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  Profile* profile = ShellProfile();
  if (profile == nullptr) {
    std::move(done).Run(base::unexpected(kNoHistory));
    return;
  }
  ClearBrowsingDataIn(*profile, clearing, std::move(done));
}

// One request line, answered from the UI thread.
//
// Runs on the UI thread because `ShellSource` is unlocked and UI-thread only,
// and loading a shell navigates a window. `reply` is bound to the IO thread,
// so it may be called from any thread, and later for `load_shell`,
// `load_unpacked` and the History app's commands.
void AnswerOnUIThread(const std::string& line, CommandReply reply) {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);
  AnswerCommand(line,
                {.load_shell = &LoadShellIntoTheShellWindow,
                 .run_app = &RunAppInAnAppWindow,
                 .open_url = &OpenUrlInABrowserWindow,
                 .list_site_permissions = &ListShellSitePermissions,
                 .set_site_permission = &SetShellSitePermission,
                 .load_unpacked = &LoadUnpackedIntoTheShellProfile,
                 .uninstall_extension = &UninstallFromTheShellProfile,
                 .list_config_extensions =
                     &ListTheShellProfilesConfigExtensions,
                 .list_extensions = &ListShellExtensions,
                 .set_extension_enabled = &SetShellExtensionEnabled,
                 .list_media_devices = &ListShellMediaDevices,
                 .set_media_device = &PreferShellMediaDevice,
                 .search_history = &SearchShellHistory,
                 .list_visits = &ListShellVisits,
                 .delete_visits = &DeleteShellVisits,
                 .clear_browsing_data = &ClearShellBrowsingData},
                std::move(reply));
}

// The socket the supervisor dials, on the browser's IO thread.
//
// Serves one connection at a time; each connection carries one request. Lives
// for the life of the browser.
class CommandSocket {
 public:
  CommandSocket()
      : listener_(base::BindRepeating(&ConnectedByUs),
                  /*use_abstract_namespace=*/false),
        read_buffer_(
            base::MakeRefCounted<net::IOBufferWithSize>(kReadBufferSize)) {}

  CommandSocket(const CommandSocket&) = delete;
  CommandSocket& operator=(const CommandSocket&) = delete;

  ~CommandSocket() = default;

  void Listen(const std::string& path) {
    CHECK_CURRENTLY_ON(content::BrowserThread::IO);
    // Crash on failure: the socket was asked for, and a missing one would
    // look like a `load-shell` that did nothing. The supervisor makes a fresh
    // path per run, so a stale file here is a bug too.
    const int result = listener_.BindAndListen(path, kBacklog);
    CHECK_EQ(result, net::OK)
        << "domicile: could not listen on " << path << ": "
        << net::ErrorToString(result);
    LOG(INFO) << "domicile: taking commands on " << path;
    Accept();
  }

 private:
  void Accept() {
    const int result = listener_.Accept(
        &connection_,
        base::BindOnce(&CommandSocket::OnAccept, base::Unretained(this)));
    if (result != net::ERR_IO_PENDING) {
      OnAccept(result);
    }
  }

  void OnAccept(int result) {
    if (result != net::OK) {
      // No retry: `Accept` fails only when the listener is broken, and a
      // synchronous error would spin this thread forever.
      LOG(ERROR) << "domicile: the command socket stopped accepting: "
                 << net::ErrorToString(result)
                 << ". This desktop will not take further commands.";
      return;
    }
    request_.clear();
    Read();
  }

  void Read() {
    const int result = connection_->Read(
        read_buffer_.get(), kReadBufferSize,
        base::BindOnce(&CommandSocket::OnRead, base::Unretained(this)));
    if (result != net::ERR_IO_PENDING) {
      OnRead(result);
    }
  }

  void OnRead(int result) {
    if (result <= 0) {
      // The peer closed or failed before sending a full line.
      Close();
      return;
    }

    request_.append(read_buffer_->data(), static_cast<size_t>(result));

    const size_t newline = request_.find('\n');
    if (newline == std::string::npos) {
      if (request_.size() > kMaxRequestSize) {
        Reply(RefusedCommand(
            "a request is one line of JSON, and this one has not ended"));
        return;
      }
      Read();
      return;
    }

    // One request per connection: anything after the first newline is
    // dropped.
    content::GetUIThreadTaskRunner({})->PostTask(
        FROM_HERE,
        base::BindOnce(
            &AnswerOnUIThread, request_.substr(0, newline),
            base::BindPostTask(content::GetIOThreadTaskRunner({}),
                               base::BindOnce(&CommandSocket::Reply,
                                              base::Unretained(this)))));
  }

  void Reply(std::string line) {
    write_buffer_ = std::move(line);
    write_offset_ = 0;
    OnWrite(net::OK);
  }

  void OnWrite(int result) {
    if (result < 0) {
      LOG(ERROR) << "domicile: could not answer a command: "
                 << net::ErrorToString(result);
      Close();
      return;
    }
    write_offset_ += static_cast<size_t>(result);
    if (write_offset_ >= write_buffer_.size()) {
      Close();
      return;
    }

    auto remaining = base::MakeRefCounted<net::StringIOBuffer>(
        write_buffer_.substr(write_offset_));
    const int written = connection_->Write(
        remaining.get(), remaining->size(),
        base::BindOnce(&CommandSocket::OnWrite, base::Unretained(this)),
        MISSING_TRAFFIC_ANNOTATION);
    if (written != net::ERR_IO_PENDING) {
      OnWrite(written);
    }
  }

  // Closing ends the reply: the supervisor reads until end of stream.
  void Close() {
    connection_.reset();
    request_.clear();
    write_buffer_.clear();
    Accept();
  }

  net::UnixDomainServerSocket listener_;
  std::unique_ptr<net::StreamSocket> connection_;

  scoped_refptr<net::IOBufferWithSize> read_buffer_;
  std::string request_;

  std::string write_buffer_;
  size_t write_offset_ = 0;
};

void ListenOnIOThread(const std::string& path) {
  static base::NoDestructor<CommandSocket> socket;
  socket->Listen(path);
}

}  // namespace

void StartCommandSocket() {
  CHECK_CURRENTLY_ON(content::BrowserThread::UI);

  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();
  if (!command_line.HasSwitch(kDomicileCommandSocketSwitch)) {
    return;
  }

  // A net socket needs an IO message pump; the IO thread has one, and the
  // traffic is too light for a dedicated thread.
  content::GetIOThreadTaskRunner({})->PostTask(
      FROM_HERE,
      base::BindOnce(&ListenOnIOThread, command_line.GetSwitchValueASCII(
                                            kDomicileCommandSocketSwitch)));
}

}  // namespace domicile
