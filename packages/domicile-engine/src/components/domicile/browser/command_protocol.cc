// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/command_protocol.h"

#include <algorithm>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/types/expected.h"
#include "base/values.h"
#include "components/domicile/browser/site_permissions.h"

namespace domicile {
namespace {

// The command names.
constexpr char kLoadShell[] = "load_shell";
constexpr char kRunApp[] = "run_app";
constexpr char kOpenUrl[] = "open_url";
constexpr char kListSitePermissionsCommand[] = "site_permissions";
constexpr char kSetSitePermissionCommand[] = "set_site_permission";
constexpr char kLoadUnpacked[] = "load_unpacked";
constexpr char kUninstallExtension[] = "uninstall_extension";
constexpr char kConfigExtensions[] = "config_extensions";
constexpr char kExtensions[] = "extensions";
constexpr char kSetExtensionEnabled[] = "set_extension_enabled";
constexpr char kMediaDevices[] = "media_devices";
constexpr char kSetMediaDevice[] = "set_media_device";

std::string Line(base::DictValue reply) {
  std::string line;
  // Replies hold only strings, lists and objects, so a write failure is a
  // bug.
  CHECK(base::JSONWriter::Write(reply, &line));
  line.push_back('\n');
  return line;
}

std::string Done(std::string_view type) {
  base::DictValue reply;
  reply.Set("type", type);
  return Line(std::move(reply));
}

std::string AnswerLoadShell(const base::DictValue& request,
                            LoadShell load_shell);
std::string AnswerRunApp(const base::DictValue& request, RunApp run_app);
std::string AnswerOpenUrl(const base::DictValue& request, OpenUrl open_url);
std::string AnswerSitePermissions(ListSitePermissions list_site_permissions);
std::string AnswerSetSitePermission(const base::DictValue& request,
                                    SetSitePermission set_site_permission);
void AnswerLoadUnpacked(const base::DictValue& request,
                        LoadUnpacked load_unpacked,
                        CommandReply reply);
std::string AnswerUninstallExtension(const base::DictValue& request,
                                     UninstallExtension uninstall_extension);
std::string AnswerConfigExtensions(
    ListConfigExtensions list_config_extensions);
std::string AnswerExtensions(ListExtensions list_extensions);
std::string AnswerSetExtensionEnabled(const base::DictValue& request,
                                      SetExtensionEnabled set_extension_enabled);
std::string AnswerMediaDevices(ListMediaDevices list_media_devices);
std::string AnswerSetMediaDevice(const base::DictValue& request,
                                 SetMediaDevice set_media_device);

}  // namespace

SitePermissionList::SitePermissionList() = default;
SitePermissionList::SitePermissionList(const SitePermissionList&) = default;
SitePermissionList& SitePermissionList::operator=(const SitePermissionList&) =
    default;
SitePermissionList::~SitePermissionList() = default;

InstalledExtension::InstalledExtension() = default;
InstalledExtension::InstalledExtension(const InstalledExtension&) = default;
InstalledExtension& InstalledExtension::operator=(const InstalledExtension&) =
    default;
InstalledExtension::~InstalledExtension() = default;

MediaDeviceList::MediaDeviceList() = default;
MediaDeviceList::MediaDeviceList(const MediaDeviceList&) = default;
MediaDeviceList& MediaDeviceList::operator=(const MediaDeviceList&) = default;
MediaDeviceList::~MediaDeviceList() = default;

std::string RefusedCommand(std::string_view why) {
  base::DictValue reply;
  reply.Set("type", "refused");
  reply.Set("why", why);
  return Line(std::move(reply));
}

void AnswerCommand(std::string_view line,
                   const CommandActions& actions,
                   CommandReply reply) {
  const std::optional<base::DictValue> request =
      base::JSONReader::ReadDict(line, base::JSON_PARSE_RFC);
  if (!request) {
    std::move(reply).Run(RefusedCommand(
        "a command is one JSON object on one line, and this is not one"));
    return;
  }

  // Check the version before `type`: an unknown version means the rest of the
  // request cannot be trusted either.
  const std::optional<int> version = request->FindInt("version");
  if (version != kCommandVersion) {
    std::move(reply).Run(RefusedCommand(base::StrCat(
        {"this engine speaks version ", base::NumberToString(kCommandVersion),
         " of the command protocol and the request says ",
         version ? base::NumberToString(*version) : std::string("nothing"),
         ". The supervisor and the engine are published separately, so this "
         "is two different releases talking rather than a typo: "
         "packages/domicile-engine/engine-release.nix is which engine this "
         "desktop is running."})));
    return;
  }

  const std::string* type = request->FindString("type");
  if (type == nullptr) {
    std::move(reply).Run(RefusedCommand("a command needs a \"type\""));
    return;
  }
  if (*type == kLoadShell) {
    std::move(reply).Run(AnswerLoadShell(*request, actions.load_shell));
    return;
  }
  if (*type == kRunApp) {
    std::move(reply).Run(AnswerRunApp(*request, actions.run_app));
    return;
  }
  if (*type == kOpenUrl) {
    std::move(reply).Run(AnswerOpenUrl(*request, actions.open_url));
    return;
  }
  if (*type == kListSitePermissionsCommand) {
    std::move(reply).Run(AnswerSitePermissions(actions.list_site_permissions));
    return;
  }
  if (*type == kSetSitePermissionCommand) {
    std::move(reply).Run(
        AnswerSetSitePermission(*request, actions.set_site_permission));
    return;
  }
  if (*type == kLoadUnpacked) {
    AnswerLoadUnpacked(*request, actions.load_unpacked, std::move(reply));
    return;
  }
  if (*type == kUninstallExtension) {
    std::move(reply).Run(
        AnswerUninstallExtension(*request, actions.uninstall_extension));
    return;
  }
  if (*type == kConfigExtensions) {
    std::move(reply).Run(
        AnswerConfigExtensions(actions.list_config_extensions));
    return;
  }
  if (*type == kExtensions) {
    std::move(reply).Run(AnswerExtensions(actions.list_extensions));
    return;
  }
  if (*type == kSetExtensionEnabled) {
    std::move(reply).Run(
        AnswerSetExtensionEnabled(*request, actions.set_extension_enabled));
    return;
  }
  if (*type == kMediaDevices) {
    std::move(reply).Run(AnswerMediaDevices(actions.list_media_devices));
    return;
  }
  if (*type == kSetMediaDevice) {
    std::move(reply).Run(
        AnswerSetMediaDevice(*request, actions.set_media_device));
    return;
  }
  std::move(reply).Run(RefusedCommand(base::StrCat(
      {"\"", *type, "\" is not a command this engine knows; it takes \"",
       kLoadShell, "\", \"", kRunApp, "\", \"", kOpenUrl, "\", \"",
       kListSitePermissionsCommand,
       "\", \"", kSetSitePermissionCommand, "\", \"", kLoadUnpacked, "\", \"",
       kUninstallExtension, "\", \"", kConfigExtensions, "\", \"",
       kExtensions, "\", \"", kSetExtensionEnabled, "\", \"",
       kMediaDevices, "\" and \"", kSetMediaDevice, "\""})));
}

namespace {

std::string AnswerLoadShell(const base::DictValue& request,
                            LoadShell load_shell) {
  // Requires both `root` and `module`: changing only one would serve a 404 or
  // the wrong shell.
  const std::string* root = request.FindString("root");
  if (root == nullptr || root->empty()) {
    return RefusedCommand(
        "load_shell needs a \"root\": the directory the shell is served out "
        "of");
  }
  const base::FilePath shell_root = base::FilePath::FromUTF8Unsafe(*root);
  if (!shell_root.IsAbsolute()) {
    return RefusedCommand(base::StrCat(
        {"\"", *root,
         "\" is not an absolute path. The root is resolved in the engine's "
         "process, whose working directory the sender does not know -- a "
         "relative one would serve some other directory without saying so."}));
  }

  const std::string* module = request.FindString("module");
  if (module == nullptr || module->empty()) {
    return RefusedCommand(
        "load_shell needs a \"module\": the one JavaScript file a shell is, "
        "as a name under \"root\"");
  }

  // The root and module are not checked here. `domicile load-shell` validates
  // the path first (`shell_path` in domicile-launch), and the shell document
  // shows an error if the module fails to load.
  if (!load_shell(shell_root, *module)) {
    return RefusedCommand(
        "this engine has no shell window to load a shell into");
  }
  return Done("loaded");
}

std::string AnswerRunApp(const base::DictValue& request, RunApp run_app) {
  const std::string* root = request.FindString("root");
  const std::string* module = request.FindString("module");
  if (root == nullptr || module == nullptr || module->empty()) {
    return RefusedCommand(
        "run_app needs a \"root\", the directory the app is served out of, "
        "and a \"module\", its entry as a name under the root");
  }
  // Absolute for load_shell's reason. `domicile run-app` resolves the path and
  // makes it canonical, so one directory is one app.
  const base::FilePath app_root = base::FilePath::FromUTF8Unsafe(*root);
  if (!app_root.IsAbsolute()) {
    return RefusedCommand(
        base::StrCat({"\"", *root, "\" is not an absolute path"}));
  }
  if (!run_app(app_root, *module)) {
    return RefusedCommand("this engine has no shell page to open an app in");
  }
  return Done("opened");
}

std::string AnswerOpenUrl(const base::DictValue& request, OpenUrl open_url) {
  const std::string* url = request.FindString("url");
  if (url == nullptr) {
    return RefusedCommand("open_url needs a \"url\": the address to open");
  }
  // Validated here so an invalid URL is refused instead of opening an empty
  // window and reporting success.
  const GURL parsed(*url);
  if (!parsed.is_valid()) {
    return RefusedCommand(
        base::StrCat({"\"", *url, "\" is not a URL this engine can open"}));
  }
  // Optional, so a supervisor older than app windows is still understood.
  const base::Value* app = request.Find("app");
  if (app != nullptr && !app->is_bool()) {
    return RefusedCommand(
        "open_url's \"app\" is true for an app window or false for a "
        "browser window");
  }
  if (!open_url(parsed, app != nullptr && app->GetBool())) {
    return RefusedCommand("this engine has no shell page to open it in");
  }
  return Done("opened");
}

std::string AnswerSitePermissions(ListSitePermissions list_site_permissions) {
  const std::optional<SitePermissionList> list = list_site_permissions();
  if (!list) {
    return RefusedCommand(
        "this engine has no shell, and so no profile whose site permissions "
        "to list");
  }
  base::DictValue defaults;
  for (const auto& [permission, setting] : list->defaults) {
    defaults.Set(PermissionName(permission), SettingName(setting));
  }
  base::ListValue sites;
  for (const StoredSitePermission& site : list->sites) {
    base::DictValue entry;
    entry.Set("origin", site.origin.Serialize());
    entry.Set("permission", PermissionName(site.permission));
    entry.Set("setting", SettingName(site.setting));
    sites.Append(std::move(entry));
  }
  base::DictValue reply;
  reply.Set("type", kListSitePermissionsCommand);
  reply.Set("defaults", std::move(defaults));
  reply.Set("sites", std::move(sites));
  return Line(std::move(reply));
}

std::string AnswerSetSitePermission(const base::DictValue& request,
                                    SetSitePermission set_site_permission) {
  const std::string* origin = request.FindString("origin");
  const std::string* permission_name = request.FindString("permission");
  const std::string* setting_name = request.FindString("setting");
  if (origin == nullptr || permission_name == nullptr ||
      setting_name == nullptr) {
    return RefusedCommand(
        "set_site_permission needs an \"origin\", a \"permission\" and a "
        "\"setting\"");
  }
  const GURL site(*origin);
  if (!site.is_valid() || !HasSitePermissions(site)) {
    return RefusedCommand(base::StrCat(
        {"\"", *origin,
         "\" is not a site: only http, https and extension pages have site "
         "permissions"}));
  }
  const std::optional<mojom::WebViewPermission> permission =
      PermissionNamed(*permission_name);
  if (!permission) {
    return RefusedCommand(
        base::StrCat({"\"", *permission_name,
                      "\" is not a permission a site is asked for"}));
  }
  const std::optional<mojom::WebViewPermissionSetting> setting =
      SettingNamed(*setting_name);
  if (!setting) {
    return RefusedCommand(base::StrCat(
        {"\"", *setting_name,
         "\" is not a setting; a site permission is \"ask\", \"allow\" or "
         "\"block\""}));
  }
  if (!set_site_permission(url::Origin::Create(site), *permission, *setting)) {
    return RefusedCommand(
        "this engine has no shell, and so no profile to store the setting in");
  }
  return Done("set");
}

void AnswerLoadUnpacked(const base::DictValue& request,
                        LoadUnpacked load_unpacked,
                        CommandReply reply) {
  const std::string* directory = request.FindString("directory");
  if (directory == nullptr || directory->empty()) {
    std::move(reply).Run(RefusedCommand(
        "load_unpacked needs a \"directory\": the folder holding the "
        "extension's manifest.json"));
    return;
  }
  const base::FilePath path = base::FilePath::FromUTF8Unsafe(*directory);
  if (!path.IsAbsolute()) {
    std::move(reply).Run(RefusedCommand(base::StrCat(
        {"\"", *directory,
         "\" is not an absolute path, and the engine's working directory is "
         "not the sender's"})));
    return;
  }
  load_unpacked(
      path, base::BindOnce(
                [](CommandReply reply,
                   base::expected<std::string, std::string> loaded) {
                  if (!loaded.has_value()) {
                    std::move(reply).Run(RefusedCommand(loaded.error()));
                    return;
                  }
                  base::DictValue done;
                  done.Set("type", "loaded_unpacked");
                  done.Set("id", loaded.value());
                  std::move(reply).Run(Line(std::move(done)));
                },
                std::move(reply)));
}

// Whether `id` is an extension id: 32 letters from a to p.
bool IsExtensionId(std::string_view id) {
  return id.size() == 32 &&
         std::ranges::all_of(id, [](char c) { return c >= 'a' && c <= 'p'; });
}

std::string AnswerUninstallExtension(const base::DictValue& request,
                                     UninstallExtension uninstall_extension) {
  const std::string* id = request.FindString("id");
  if (id == nullptr) {
    return RefusedCommand(
        "uninstall_extension needs an \"id\": the extension to uninstall");
  }
  if (!IsExtensionId(*id)) {
    return RefusedCommand(base::StrCat(
        {"\"", *id,
         "\" is not an extension id, which is 32 letters from a to p"}));
  }
  const base::expected<void, std::string> uninstalled =
      uninstall_extension(*id);
  if (!uninstalled.has_value()) {
    return RefusedCommand(uninstalled.error());
  }
  return Done("uninstalled");
}

std::string AnswerConfigExtensions(
    ListConfigExtensions list_config_extensions) {
  const std::optional<std::vector<std::string>> ids = list_config_extensions();
  if (!ids) {
    return RefusedCommand(
        "this engine has no shell, and so no profile whose extensions to "
        "list");
  }
  base::ListValue listed;
  for (const std::string& id : *ids) {
    listed.Append(id);
  }
  base::DictValue reply;
  reply.Set("type", kConfigExtensions);
  reply.Set("ids", std::move(listed));
  return Line(std::move(reply));
}

std::string AnswerExtensions(ListExtensions list_extensions) {
  const std::optional<std::vector<InstalledExtension>> extensions =
      list_extensions();
  if (!extensions) {
    return RefusedCommand(
        "this engine has no shell, and so no profile whose extensions to "
        "list");
  }
  base::ListValue listed;
  for (const InstalledExtension& extension : *extensions) {
    base::DictValue entry;
    entry.Set("id", extension.id);
    entry.Set("name", extension.name);
    entry.Set("description", extension.description);
    entry.Set("version", extension.version);
    entry.Set("enabled", extension.enabled);
    if (extension.options_url.is_valid()) {
      entry.Set("options_url", extension.options_url.spec());
    }
    listed.Append(std::move(entry));
  }
  base::DictValue reply;
  reply.Set("type", kExtensions);
  reply.Set("extensions", std::move(listed));
  return Line(std::move(reply));
}

std::string AnswerSetExtensionEnabled(
    const base::DictValue& request,
    SetExtensionEnabled set_extension_enabled) {
  const std::string* id = request.FindString("id");
  const std::optional<bool> enabled = request.FindBool("enabled");
  if (id == nullptr || !enabled) {
    return RefusedCommand(
        "set_extension_enabled needs an \"id\" and whether it is "
        "\"enabled\"");
  }
  const base::expected<void, std::string> set =
      set_extension_enabled(*id, *enabled);
  if (!set.has_value()) {
    return RefusedCommand(set.error());
  }
  return Done("set");
}

base::ListValue DeviceEntries(const std::vector<MediaDevice>& devices) {
  base::ListValue entries;
  for (const MediaDevice& device : devices) {
    base::DictValue entry;
    entry.Set("id", device.id);
    entry.Set("name", device.name);
    entries.Append(std::move(entry));
  }
  return entries;
}

std::string AnswerMediaDevices(ListMediaDevices list_media_devices) {
  const std::optional<MediaDeviceList> list = list_media_devices();
  if (!list) {
    return RefusedCommand(
        "this engine has no shell, and so no profile whose media devices to "
        "list");
  }
  base::DictValue reply;
  reply.Set("type", kMediaDevices);
  reply.Set("cameras", DeviceEntries(list->cameras));
  reply.Set("microphones", DeviceEntries(list->microphones));
  return Line(std::move(reply));
}

std::optional<MediaDeviceKind> MediaDeviceKindNamed(std::string_view name) {
  if (name == "camera") {
    return MediaDeviceKind::kCamera;
  }
  if (name == "microphone") {
    return MediaDeviceKind::kMicrophone;
  }
  return std::nullopt;
}

std::string AnswerSetMediaDevice(const base::DictValue& request,
                                 SetMediaDevice set_media_device) {
  const std::string* kind_name = request.FindString("kind");
  const std::string* id = request.FindString("id");
  if (kind_name == nullptr || id == nullptr) {
    return RefusedCommand(
        "set_media_device needs a \"kind\" and an \"id\": the device sites "
        "get when they name none");
  }
  const std::optional<MediaDeviceKind> kind = MediaDeviceKindNamed(*kind_name);
  if (!kind) {
    return RefusedCommand(
        base::StrCat({"\"", *kind_name,
                      "\" is not a kind of device; it is \"camera\" or "
                      "\"microphone\""}));
  }
  const base::expected<void, std::string> set = set_media_device(*kind, *id);
  if (!set.has_value()) {
    return RefusedCommand(set.error());
  }
  return Done("set");
}

}  // namespace
}  // namespace domicile
